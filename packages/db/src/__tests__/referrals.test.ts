import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { subscriptionCharges, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

describe.skipIf(!hasDb)("referrals (0072): reward on first paid charge, anti-abuse, idempotency", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const ids: Record<"ref" | "good" | "sameIp" | "other", string> = { ref: "", good: "", sameIp: "", other: "" };

  const summary = (tenantId: string) =>
    withTenant(app.db, tenantId, async (tx) => {
      const [r] = await tx.execute<{ code: string; referred: number; pending: number; rewarded: number; rejected: number; credits_available: number }>(
        sql`select * from public.tenant_referral_summary()`,
      );
      if (!r) throw new Error("no summary");
      return r;
    });

  const payMonthly = (tenantId: string) =>
    withTenant(app.db, tenantId, async (tx) => {
      const [c] = await tx.execute<{ id: string }>(sql`select public.subscription_charge_create('start', 49::numeric, 'usd', 'usdtbsc', null, 30) as id`);
      const id = c?.id ?? "";
      await tx.execute(sql`select public.subscription_charge_attach(${id}::uuid, ${String(Date.now()) + String(Math.floor(Math.random() * 1000))}, '0xabc', 49, 'usdtbsc', 'waiting')`);
      await tx.execute(sql`select * from public.subscription_charge_apply(${id}::uuid, 'paid', 'webhook', 'finished', 49::numeric, null)`);
      return id;
    });

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const rows = await tx
        .insert(tenants)
        .values((["ref", "good", "sameIp", "other"] as const).map((k) => ({ slug: `rf-${k.toLowerCase()}-${suffix}`, name: `Ref ${k}` })))
        .returning({ id: tenants.id, slug: tenants.slug });
      for (const r of rows) {
        const k = (["ref", "good", "sameIp", "other"] as const).find((x) => r.slug.startsWith(`rf-${x.toLowerCase()}-`));
        if (k) ids[k] = r.id;
      }
    });
    const signals = (id: string, ip: string, email: string) =>
      withTenant(app.db, id, (tx) => tx.execute(sql`select public.tenant_signup_signals_record(${id}::uuid, ${ip}::inet, ${email})`));
    await signals(ids.ref, "10.0.0.1", `ref-${suffix}@x.com`);
    await signals(ids.good, "10.0.0.2", `good-${suffix}@x.com`);
    await signals(ids.sameIp, "10.0.0.1", `same-${suffix}@x.com`);
  });

  afterAll(async () => {
    if (migrator) {
      const all = Object.values(ids).filter(Boolean);
      if (all.length) await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(tenants).where(inArray(tenants.id, all)));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("records referrals at signup; self-referral is impossible", async () => {
    const { code } = await summary(ids.ref);
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    const rec = async (tenant: string, c: string) => {
      const [r] = await withTenant(app.db, tenant, (tx) => tx.execute<{ ok: boolean }>(sql`select public.tenant_referral_record(${tenant}::uuid, ${c}) as ok`));
      return r?.ok;
    };
    // 0094: without (or with another tenant's) context nothing is recorded.
    const [noCtx] = await app.db.execute<{ ok: boolean }>(sql`select public.tenant_referral_record(${ids.other}::uuid, ${code}) as ok`);
    expect(noCtx?.ok).toBe(false);
    const [wrongCtx] = await withTenant(app.db, ids.good, (tx) =>
      tx.execute<{ ok: boolean }>(sql`select public.tenant_referral_record(${ids.other}::uuid, ${code}) as ok`),
    );
    expect(wrongCtx?.ok).toBe(false);
    expect(await rec(ids.ref, code)).toBe(false);
    expect(await rec(ids.good, code.toLowerCase())).toBe(true);
    expect(await rec(ids.sameIp, code)).toBe(true);
    expect(await rec(ids.other, "ZZZZZZZZ")).toBe(false);
    expect((await summary(ids.ref)).pending).toBe(2);
  });

  it("rewards only on the referred tenant's first paid charge, once", async () => {
    await payMonthly(ids.good);
    await payMonthly(ids.good);
    const s = await summary(ids.ref);
    expect(s.rewarded).toBe(1);
    expect(s.credits_available).toBe(1);
  });

  it("no reward when the referred tenant shares the signup IP", async () => {
    await payMonthly(ids.sameIp);
    const s = await summary(ids.ref);
    expect(s.rejected).toBe(1);
    expect(s.credits_available).toBe(1);
  });

  it("a referral credit discounts 20% of the next monthly charge and is held by it", async () => {
    const charge = await withTenant(app.db, ids.ref, async (tx) => {
      const [r] = await tx.execute<{ id: string }>(sql`select public.subscription_charge_create_with_referral('start', 49::numeric, 'usdtbsc', null) as id`);
      const [row] = await tx.select().from(subscriptionCharges).where(sql`${subscriptionCharges.id} = ${r?.id ?? ""}`);
      return row;
    });
    expect(charge).toMatchObject({ priceAmount: "39.20", discountAmount: "9.80", referralCredits: 1 });
    expect((await summary(ids.ref)).credits_available).toBe(0);
  });
});
