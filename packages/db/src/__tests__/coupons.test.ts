import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { couponRedemptions, coupons, subscriptionCharges, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const errOf = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );
const msgOf = (err: unknown): string => String((err as { cause?: { message?: string } })?.cause?.message ?? (err as Error)?.message ?? "");

describe.skipIf(!hasDb)("coupons (0071): isolation, discount, race-safe limits, grants", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  let tenantA = "";
  let tenantB = "";
  const couponIds: string[] = [];

  const newCoupon = async (code: string, type: string, value: number, extra: { max?: number | null; perTenant?: number } = {}) => {
    const [r] = await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx
        .insert(coupons)
        .values({
          code: `${code}${suffix}`,
          type: type as "percent",
          value: String(value),
          maxRedemptions: extra.max ?? null,
          perTenantLimit: extra.perTenant ?? 1,
        })
        .returning({ id: coupons.id, code: coupons.code }),
    );
    if (!r) throw new Error("seed failed");
    couponIds.push(r.id);
    return r.code;
  };

  const createWithCoupon = (tenantId: string, code: string, list = "49.00", days = 30) =>
    withTenant(app.db, tenantId, async (tx) => {
      const [r] = await tx.execute<{ id: string }>(
        sql`select public.subscription_charge_create_with_coupon('start', ${list}::numeric, 'usdtbsc', null, ${days}::integer, ${code}) as id`,
      );
      return r?.id ?? "";
    });

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 4 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a, b] = await tx
        .insert(tenants)
        .values([
          { slug: `cpn-a-${suffix.toLowerCase()}`, name: "Cpn A" },
          { slug: `cpn-b-${suffix.toLowerCase()}`, name: "Cpn B" },
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
      if (couponIds.length) await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(coupons).where(inArray(coupons.id, couponIds)));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("the app role cannot read the platform coupons table", async () => {
    const err = await errOf(withTenant(app.db, tenantA, (tx) => tx.select().from(coupons)));
    expect(err).toBeDefined();
  });

  it("stores list price, discount and final price computed in SQL", async () => {
    const code = await newCoupon("PCT", "percent", 20);
    const id = await createWithCoupon(tenantA, code.toLowerCase());
    const [row] = await withTenant(app.db, tenantA, (tx) => tx.select().from(subscriptionCharges).where(sql`${subscriptionCharges.id} = ${id}`));
    expect(row).toMatchObject({ priceAmount: "39.20", listPriceAmount: "49.00", discountAmount: "9.80", couponCode: code });
  });

  it("max_redemptions is race-safe: concurrent holds cannot exceed it", async () => {
    const code = await newCoupon("MAX", "fixed_usd", 5, { max: 1, perTenant: 5 });
    const results = await Promise.all([errOf(createWithCoupon(tenantA, code)), errOf(createWithCoupon(tenantB, code))]);
    const failures = results.filter((e) => e !== undefined);
    expect(failures).toHaveLength(1);
    expect(msgOf(failures[0])).toContain("coupon: exhausted");
  });

  it("counts the redemption only when the charge settles as paid", async () => {
    const code = await newCoupon("PAID", "percent", 10);
    const id = await createWithCoupon(tenantB, code);
    const before = await withTenant(app.db, tenantB, (tx) => tx.select().from(couponRedemptions));
    expect(before.filter((r) => r.chargeId === id)).toHaveLength(0);
    await withTenant(app.db, tenantB, async (tx) => {
      await tx.execute(sql`select public.subscription_charge_attach(${id}::uuid, ${String(Date.now())}, '0xabc', 44.1, 'usdtbsc', 'waiting')`);
      await tx.execute(sql`select * from public.subscription_charge_apply(${id}::uuid, 'paid', 'webhook', 'finished', 44.1::numeric, null)`);
    });
    const after = await withTenant(app.db, tenantB, (tx) => tx.select().from(couponRedemptions));
    expect(after.filter((r) => r.chargeId === id)).toHaveLength(1);
    // Tenant isolation: A never sees B's redemptions.
    const seenByA = await withTenant(app.db, tenantA, (tx) => tx.select().from(couponRedemptions));
    expect(seenByA.some((r) => r.tenantId === tenantB)).toBe(false);
  });

  it("a charge paid after its hold expired and the cap was reached is recorded but flagged (0093)", async () => {
    const code = await newCoupon("OVER", "fixed_usd", 5, { max: 1, perTenant: 5 });
    const late = await createWithCoupon(tenantA, code);
    // Its 24 h hold lapses, so another tenant can take the only slot.
    await migrator.db.execute(sql`update public.subscription_charges set created_at = now() - interval '25 hours' where id = ${late}::uuid`);
    const first = await createWithCoupon(tenantB, code);
    const pay = (tenantId: string, id: string, ref: string) =>
      withTenant(app.db, tenantId, async (tx) => {
        await tx.execute(sql`select public.subscription_charge_attach(${id}::uuid, ${ref}, '0xabc', 44, 'usdtbsc', 'waiting')`);
        await tx.execute(sql`select * from public.subscription_charge_apply(${id}::uuid, 'paid', 'webhook', 'finished', 44::numeric, null)`);
      });
    await pay(tenantB, first, `${Date.now()}1`);
    await pay(tenantA, late, `${Date.now()}2`);
    const rows = await dangerouslyWithoutTenant(migrator.db, (tx) => tx.select().from(couponRedemptions).where(inArray(couponRedemptions.chargeId, [first, late])));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.chargeId === first)?.overCap).toBe(false);
    expect(rows.find((r) => r.chargeId === late)?.overCap).toBe(true);
    const audit = await migrator.db.execute<{ n: number }>(
      sql`select count(*)::int as n from public.platform_audit_events where action = 'coupon.redemption_over_cap' and diff->>'chargeId' = ${late}`,
    );
    expect([...audit][0]?.n).toBe(1);
  });

  it("a 100% coupon cannot create a provider charge but is granted with verified_by=coupon", async () => {
    const code = await newCoupon("FULL", "percent", 100);
    expect(msgOf(await errOf(createWithCoupon(tenantA, code)))).toContain("coupon: free");
    const id = await withTenant(app.db, tenantA, async (tx) => {
      const [r] = await tx.execute<{ id: string }>(sql`select public.subscription_coupon_grant(${code}, 'start', 49::numeric, 30, null) as id`);
      return r?.id ?? "";
    });
    const [row] = await withTenant(app.db, tenantA, (tx) => tx.select().from(subscriptionCharges).where(sql`${subscriptionCharges.id} = ${id}`));
    expect(row).toMatchObject({ status: "paid", verifiedBy: "coupon", priceAmount: "0.00", providerPaymentId: null, periodDays: 30 });
    // The provider path never moves a coupon grant.
    const [applied] = await withTenant(app.db, tenantA, (tx) =>
      tx.execute<{ outcome: string }>(sql`select outcome from public.subscription_charge_apply(${id}::uuid, 'refunded', null, 'refunded', null, null)`),
    );
    expect(applied?.outcome).toBe("ignored");
  });

  it("free_days extends paid_until once (idempotent double submit, then tenant limit)", async () => {
    const code = await newCoupon("DAYS", "free_days", 15);
    const grant = () =>
      withTenant(app.db, tenantB, async (tx) => {
        const [r] = await tx.execute<{ id: string }>(sql`select public.subscription_coupon_grant(${code}, 'start', 49::numeric, 30, null) as id`);
        return r?.id ?? "";
      });
    const first = await grant();
    expect(await grant()).toBe(first);
    const rows = await withTenant(app.db, tenantB, (tx) => tx.select().from(subscriptionCharges).where(sql`${subscriptionCharges.couponCode} = ${code}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ periodDays: 15, verifiedBy: "coupon" });
  });

  it("rejects an inactive or unknown coupon", async () => {
    expect(msgOf(await errOf(createWithCoupon(tenantA, `NOPE${suffix}`)))).toContain("coupon: not_found");
    const code = await newCoupon("OFF", "percent", 10);
    await dangerouslyWithoutTenant(migrator.db, (tx) => tx.update(coupons).set({ active: false }).where(sql`${coupons.code} = ${code}`));
    expect(msgOf(await errOf(createWithCoupon(tenantA, code)))).toContain("coupon: inactive");
  });
});
