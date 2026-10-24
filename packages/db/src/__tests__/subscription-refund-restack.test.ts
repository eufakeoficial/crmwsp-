import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { subscriptionCharges, subscriptionPayments, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

describe.skipIf(!hasDb)("subscription refund re-stacks later periods (0064)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let tenantId = "";

  const createCharge = (price = "89.00", days = 30) =>
    withTenant(app.db, tenantId, async (tx) => {
      const [r] = await tx.execute<{ id: string }>(sql`select public.subscription_charge_create('pro', ${price}::numeric, 'usd', 'usdtbsc', null, ${days}::integer) as id`);
      const id = r?.id ?? "";
      await tx.execute(sql`select public.subscription_charge_attach(${id}::uuid, ${randomUUID()}, '0xabc', 49.31, 'usdtbsc', 'waiting')`);
      return id;
    });

  const apply = (chargeId: string, status: "paid" | "refunded") =>
    withTenant(app.db, tenantId, async (tx) => {
      const [r] = await tx.execute<{ outcome: string; period_end: string | null }>(
        sql`select outcome, period_end::text from public.subscription_charge_apply(${chargeId}::uuid, ${status}, 'webhook', ${status}, 49.31::numeric, ${status === "paid" ? randomUUID() : null})`,
      );
      return r;
    });

  const paidUntil = () =>
    withTenant(app.db, tenantId, async (tx) => {
      const [r] = await tx.execute<{ d: string | null }>(sql`select public.tenant_subscription_paid_until()::text as d`);
      return r?.d ?? null;
    });

  const today = () => new Date().toISOString().slice(0, 10);
  const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: `subs-restack-${randomUUID().slice(0, 8)}`, name: "Restack" }).returning({ id: tenants.id });
      if (!t) throw new Error("seed failed");
      tenantId = t.id;
    });
  });

  afterAll(async () => {
    if (migrator) {
      if (tenantId) await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(tenants).where(inArray(tenants.id, [tenantId])));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("moves the stacked periods back and keeps the derived revenue rows in sync", async () => {
    const first = await createCharge();
    const second = await createCharge();
    const third = await createCharge();
    expect((await apply(first, "paid"))?.period_end).toBe(plusDays(today(), 30));
    expect((await apply(second, "paid"))?.period_end).toBe(plusDays(today(), 60));
    expect((await apply(third, "paid"))?.period_end).toBe(plusDays(today(), 90));

    expect((await apply(first, "refunded"))?.outcome).toBe("refunded");
    expect(await paidUntil()).toBe(plusDays(today(), 60));

    const rows = await dangerouslyWithoutTenant(migrator.db, async (tx) => ({
      charges: await tx
        .select({ id: subscriptionCharges.id, start: subscriptionCharges.periodStart, end: subscriptionCharges.periodEnd })
        .from(subscriptionCharges)
        .where(inArray(subscriptionCharges.id, [second, third])),
      payments: await tx
        .select({ chargeId: subscriptionPayments.chargeId, start: subscriptionPayments.periodStart, end: subscriptionPayments.periodEnd })
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.tenantId, tenantId)),
    }));
    const byId = new Map(rows.charges.map((c) => [c.id, c]));
    expect(byId.get(second)).toMatchObject({ start: today(), end: plusDays(today(), 30) });
    expect(byId.get(third)).toMatchObject({ start: plusDays(today(), 30), end: plusDays(today(), 60) });
    expect(rows.payments.map((p) => p.chargeId).sort()).toEqual([second, third].sort());
    for (const p of rows.payments) expect({ start: p.start, end: p.end }).toEqual({ start: byId.get(p.chargeId ?? "")?.start, end: byId.get(p.chargeId ?? "")?.end });
  });

  it("an annual charge grants 365 days and re-stacks with its own length after a refund", async () => {
    const before = (await paidUntil()) ?? today();
    const monthly = await createCharge();
    const annual = await createCharge("890.00", 365);
    await apply(monthly, "paid");
    expect((await apply(annual, "paid"))?.period_end).toBe(plusDays(before, 30 + 365));
    await apply(monthly, "refunded");
    expect(await paidUntil()).toBe(plusDays(before, 365));
    await apply(annual, "refunded");
  });

  it("rejects period lengths other than 30 or 365 days", async () => {
    await expect(createCharge("89.00", 31)).rejects.toThrow();
  });

  it("refunding the last period moves nothing else", async () => {
    const before = await paidUntil();
    const last = await createCharge();
    await apply(last, "paid");
    expect(await paidUntil()).toBe(plusDays(before ?? today(), 30));
    await apply(last, "refunded");
    expect(await paidUntil()).toBe(before);
  });
});
