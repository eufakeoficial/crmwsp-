import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { consumeUsage, readPlanUsage } from "../plan-usage.js";
import { tenantPlans, tenants, usageCounters } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const pgCode = (err: unknown): string | undefined =>
  ((err as Error & { cause?: { code?: string } } | undefined)?.cause ?? (err as { code?: string } | undefined))?.code;
const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

describe.skipIf(!hasDb)("billing tables isolation (RLS) with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let tenantA = "";
  let tenantB = "";
  let counterB = "";

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a, b] = await tx
        .insert(tenants)
        .values([
          { slug: `bill-a-${suffix}`, name: "Billing A" },
          { slug: `bill-b-${suffix}`, name: "Billing B" },
        ])
        .returning({ id: tenants.id });
      if (!a || !b) throw new Error("seed failed");
      tenantA = a.id;
      tenantB = b.id;
      // 0068: a trigger already created each tenant's lifecycle row; set the plan on it.
      await tx.update(tenantPlans).set({ plan: "start" }).where(eq(tenantPlans.tenantId, tenantA));
      await tx.update(tenantPlans).set({ plan: "pro" }).where(eq(tenantPlans.tenantId, tenantB));
      const [c] = await tx
        .insert(usageCounters)
        .values([
          { tenantId: tenantA, period: "2026-10", limitKey: "ai_messages", used: 3 },
          { tenantId: tenantB, period: "2026-10", limitKey: "ai_messages", used: 7 },
        ])
        .returning({ id: usageCounters.id, tenantId: usageCounters.tenantId });
      if (!c) throw new Error("seed failed");
      const [rowB] = await tx.select({ id: usageCounters.id }).from(usageCounters).where(eq(usageCounters.tenantId, tenantB));
      counterB = rowB?.id ?? "";
    });
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [tenantA, tenantB].filter(Boolean);
      if (ids.length) await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(tenants).where(inArray(tenants.id, ids)));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("selects only the current tenant's plan and counters", async () => {
    const r = await withTenant(app.db, tenantA, async (tx) => ({
      plans: await tx.select({ tenantId: tenantPlans.tenantId, plan: tenantPlans.plan }).from(tenantPlans),
      counters: await tx.select({ tenantId: usageCounters.tenantId, used: usageCounters.used }).from(usageCounters),
    }));
    expect(r.plans).toEqual([{ tenantId: tenantA, plan: "start" }]);
    expect(r.counters).toEqual([{ tenantId: tenantA, used: 3 }]);
  });

  it("app role cannot change its own plan", async () => {
    const err = await settle(withTenant(app.db, tenantA, (tx) => tx.update(tenantPlans).set({ plan: "pro" })));
    expect(pgCode(err)).toBe("42501");
    const insertErr = await settle(withTenant(app.db, tenantA, (tx) => tx.insert(tenantPlans).values({ tenantId: tenantA, plan: "pro" })));
    expect(pgCode(insertErr)).toBe("42501");
  });

  it("app role cannot insert a counter for another tenant (WITH CHECK)", async () => {
    const err = await settle(
      withTenant(app.db, tenantA, (tx) => tx.insert(usageCounters).values({ tenantId: tenantB, period: "2026-11", limitKey: "ai_messages", used: 1 })),
    );
    expect(pgCode(err)).toBe("42501");
  });

  it("update of another tenant's counter affects 0 rows, and delete is revoked", async () => {
    const updated = await withTenant(app.db, tenantA, (tx) =>
      tx.update(usageCounters).set({ used: sql`${usageCounters.used} + 100` }).where(eq(usageCounters.id, counterB)).returning({ id: usageCounters.id }),
    );
    expect(updated).toHaveLength(0);
    const delErr = await settle(withTenant(app.db, tenantA, (tx) => tx.delete(usageCounters)));
    expect(pgCode(delErr)).toBe("42501");
    const [row] = await migrator.db.select({ used: usageCounters.used }).from(usageCounters).where(eq(usageCounters.id, counterB));
    expect(row?.used).toBe(7);
  });

  it("consumeUsage increments within the limit and refuses past it", async () => {
    const r = await withTenant(app.db, tenantB, async (tx) => {
      const before = await readPlanUsage(tx);
      const first = await consumeUsage(tx, tenantB, "broadcast_sends", 2, 3);
      const second = await consumeUsage(tx, tenantB, "broadcast_sends", 2, 3);
      const after = await readPlanUsage(tx);
      return { before, first, second, after };
    });
    expect(r.before.plan).toBe("pro");
    expect(r.first).toBe(2);
    expect(r.second).toBeNull();
    expect(r.after.broadcastSends).toBe(2);
  });
});
