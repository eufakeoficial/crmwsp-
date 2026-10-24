import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { channelConnections, tenantPlans, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const pgCode = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null ? ((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) : undefined;

describe.skipIf(!hasDb)("tenant trial lifecycle (0068)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let tenantA = "";
  let tenantB = "";

  const lifecycle = (tenantId: string) =>
    dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [r] = await tx.select().from(tenantPlans).where(eq(tenantPlans.tenantId, tenantId));
      return r;
    });
  const startTrial = (tenantId: string) =>
    withTenant(app.db, tenantId, async (tx) => {
      const [r] = await tx.execute<{ started: boolean }>(sql`select public.tenant_trial_start() as started`);
      return r?.started;
    });

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const rows = await tx
        .insert(tenants)
        .values([
          { slug: `trial-a-${randomUUID().slice(0, 8)}`, name: "Trial A" },
          { slug: `trial-b-${randomUUID().slice(0, 8)}`, name: "Trial B" },
        ])
        .returning({ id: tenants.id });
      tenantA = rows[0]?.id ?? "";
      tenantB = rows[1]?.id ?? "";
    });
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(tenants).where(inArray(tenants.id, [tenantA, tenantB])));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("a new tenant starts in setup for 7 days", async () => {
    const r = await lifecycle(tenantA);
    expect(r?.setupEndsAt).toBeInstanceOf(Date);
    const days = ((r?.setupEndsAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(r?.trialStartedAt).toBeNull();
  });

  it("no trial without an active channel; the first active channel starts it once", async () => {
    expect(await startTrial(tenantA)).toBe(false);
    await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx.insert(channelConnections).values({ tenantId: tenantA, provider: "gupshup", phoneE164: "+59170000999", webhookToken: randomUUID(), status: "active" }),
    );
    expect(await startTrial(tenantA)).toBe(true);
    expect(await startTrial(tenantA)).toBe(false);
    const r = await lifecycle(tenantA);
    expect(r?.trialEndsAt).toBeInstanceOf(Date);
  });

  it("tenant B's active channel never starts A's trial (isolation) and the app cannot edit tenant_plans", async () => {
    const before = await lifecycle(tenantB);
    expect(await startTrial(tenantB)).toBe(false);
    expect((await lifecycle(tenantB))?.trialStartedAt).toEqual(before?.trialStartedAt ?? null);
    const seen = await withTenant(app.db, tenantB, (tx) => tx.select({ tenantId: tenantPlans.tenantId }).from(tenantPlans));
    expect(seen.map((r) => r.tenantId)).toEqual([tenantB]);
    const upd = await withTenant(app.db, tenantB, (tx) => tx.update(tenantPlans).set({ setupEndsAt: new Date(Date.now() + 1e12) })).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgCode(upd)).toBe("42501");
  });
});
