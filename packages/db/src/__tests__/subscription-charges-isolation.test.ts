import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { subscriptionCharges, subscriptionPayments, tenantPlans, tenants } from "../schema/index.js";
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

describe.skipIf(!hasDb)("subscription charges (NOWPayments) isolation and settlement", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let tenantA = "";
  let tenantB = "";

  const createCharge = (tenantId: string, plan: "start" | "pro", price: string) =>
    withTenant(app.db, tenantId, async (tx) => {
      const [r] = await tx.execute<{ id: string }>(
        sql`select public.subscription_charge_create(${plan}, ${price}::numeric, 'usd', 'usdtbsc', null) as id`,
      );
      const id = r?.id ?? "";
      const providerId = String(Math.floor(Math.random() * 1e12));
      await tx.execute(sql`select public.subscription_charge_attach(${id}::uuid, ${providerId}, '0xabc', 49.31, 'usdtbsc', 'waiting')`);
      return id;
    });

  const apply = (tenantId: string, chargeId: string, status: string, paid: string | null, hash: string | null) =>
    withTenant(app.db, tenantId, async (tx) => {
      const [r] = await tx.execute<{ outcome: string; period_end: string | null }>(
        sql`select outcome, period_end::text from public.subscription_charge_apply(${chargeId}::uuid, ${status}, 'webhook', ${status}, ${paid}::numeric, ${hash})`,
      );
      return r;
    });

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a, b] = await tx
        .insert(tenants)
        .values([
          { slug: `subs-a-${suffix}`, name: "Subs A" },
          { slug: `subs-b-${suffix}`, name: "Subs B" },
        ])
        .returning({ id: tenants.id });
      if (!a || !b) throw new Error("seed failed");
      tenantA = a.id;
      tenantB = b.id;
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

  it("each tenant reads only its own charges", async () => {
    const a = await createCharge(tenantA, "pro", "89.00");
    const b = await createCharge(tenantB, "start", "49.00");
    const seenByA = await withTenant(app.db, tenantA, (tx) => tx.select({ id: subscriptionCharges.id }).from(subscriptionCharges));
    expect(seenByA.map((r) => r.id)).toContain(a);
    expect(seenByA.map((r) => r.id)).not.toContain(b);
  });

  it("the app role cannot write charges directly", async () => {
    const ins = await settle(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(subscriptionCharges).values({ tenantId: tenantA, plan: "pro", priceAmount: "1.00", priceCurrency: "usd", payCurrency: "usdtbsc" }),
      ),
    );
    expect(pgCode(ins)).toBe("42501");
    const upd = await settle(withTenant(app.db, tenantA, (tx) => tx.update(subscriptionCharges).set({ status: "paid" })));
    expect(pgCode(upd)).toBe("42501");
  });

  it("another tenant cannot settle a charge (not_found)", async () => {
    const a = await createCharge(tenantA, "pro", "89.00");
    expect(await apply(tenantB, a, "paid", "49.31", `0xhash-${randomUUID()}`)).toMatchObject({ outcome: "not_found" });
  });

  it("settles once, grants 30 days and the plan; replays are ignored; underpaid is refused", async () => {
    const a = await createCharge(tenantA, "pro", "89.00");
    expect(await apply(tenantA, a, "paid", "1", null)).toMatchObject({ outcome: "underpaid" });
    const first = await apply(tenantA, a, "paid", "49.31", `0xhash-${a}`);
    expect(first?.outcome).toBe("paid");
    expect(await apply(tenantA, a, "paid", "49.31", `0xhash-${a}`)).toMatchObject({ outcome: "ignored" });
    expect(await apply(tenantA, a, "expired", null, null)).toMatchObject({ outcome: "ignored" });
    const rows = await migrator.db.select().from(subscriptionPayments).where(eq(subscriptionPayments.chargeId, a));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: "nowpayments", amountMinor: 8900, currency: "USD", periodEnd: first?.period_end });
    const [plan] = await migrator.db.select({ plan: tenantPlans.plan }).from(tenantPlans).where(eq(tenantPlans.tenantId, tenantA));
    expect(plan?.plan).toBe("pro");
    const paidUntil = await withTenant(app.db, tenantA, async (tx) => {
      const [r] = await tx.execute<{ d: string | null }>(sql`select public.tenant_subscription_paid_until()::text as d`);
      return r?.d ?? null;
    });
    expect(paidUntil).toBe(first?.period_end);
  });

  it("one payin_hash cannot settle two charges", async () => {
    const hash = `0xdup-${randomUUID()}`;
    const c1 = await createCharge(tenantA, "start", "49.00");
    const c2 = await createCharge(tenantA, "start", "49.00");
    expect(await apply(tenantA, c1, "paid", "49.31", hash)).toMatchObject({ outcome: "paid" });
    expect(await apply(tenantA, c2, "paid", "49.31", hash)).toMatchObject({ outcome: "payin_hash_conflict" });
  });

  it("a refund revokes the period and is terminal", async () => {
    const c = await createCharge(tenantB, "start", "49.00");
    expect(await apply(tenantB, c, "paid", "49.31", `0xref-${c}`)).toMatchObject({ outcome: "paid" });
    expect(await apply(tenantB, c, "refunded", null, null)).toMatchObject({ outcome: "refunded" });
    const rows = await migrator.db.select().from(subscriptionPayments).where(eq(subscriptionPayments.chargeId, c));
    expect(rows).toHaveLength(0);
    expect(await apply(tenantB, c, "paid", "49.31", null)).toMatchObject({ outcome: "ignored" });
  });

  it("ingest_nowpayments_event resolves the tenant from the charge and dedupes", async () => {
    const c = await createCharge(tenantA, "start", "49.00");
    const key = `nowpayments:${randomUUID()}:finished`;
    const run = () =>
      app.sql<{ event_id: string; tenant_id: string; inserted: boolean }[]>`
        select event_id, tenant_id, inserted from public.ingest_nowpayments_event(${key}, ${c}, ${JSON.stringify({ order_id: c })}::jsonb)`;
    const [first] = await run();
    const [second] = await run();
    expect(first).toMatchObject({ tenant_id: tenantA, inserted: true });
    expect(second).toMatchObject({ event_id: first?.event_id, inserted: false });
    const none = await app.sql`select * from public.ingest_nowpayments_event(${`nowpayments:x:y`}, ${randomUUID()}, '{}'::jsonb)`;
    expect(none).toHaveLength(0);
  });
});
