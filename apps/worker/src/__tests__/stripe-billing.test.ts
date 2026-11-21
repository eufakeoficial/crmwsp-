import { randomUUID } from "node:crypto";
import { stripePriceMapFromEnv } from "@crmwsp/billing";
import { sql, withTenant, type DbHandle } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { settleStripeBillingEvent } from "../subscription-billing/stripe.js";
import { APP_URL, MIGRATOR_URL, createDb, dropTenants, hasEnv, seedTenants, type SeedTenant } from "./helpers.js";

const prices = stripePriceMapFromEnv({
  STRIPE_PRICE_START_MONTHLY: "price_sm",
  STRIPE_PRICE_START_ANNUAL: "price_sa",
  STRIPE_PRICE_PRO_MONTHLY: "price_pm",
  STRIPE_PRICE_PRO_ANNUAL: "price_pa",
});

describe.skipIf(!hasEnv)("Stripe billing settlement (Postgres, RLS)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let A: SeedTenant;
  let B: SeedTenant;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const customerA = `cus_A${suffix}`;
  const customerB = `cus_B${suffix}`;
  let n = 0;

  const deps = () => ({ db: app.db, stripePrices: prices });

  async function ingest(tenant: SeedTenant, event: Record<string, unknown>): Promise<string> {
    const id = `evt_${suffix}_${++n}`;
    const payload = JSON.stringify({ id, created: 1_800_000_000 + n, ...event });
    const [row] = await migrator.db.execute<{ id: string }>(
      sql`insert into inbound_events (tenant_id, provider, dedupe_key, payload, signature_valid)
          values (${tenant.tenantId}, 'stripe'::channel_provider, ${`stripe_billing:${id}`}, ${payload}::jsonb, true) returning id`,
    );
    return row!.id;
  }
  const run = async (tenant: SeedTenant, event: Record<string, unknown>) =>
    settleStripeBillingEvent(deps(), { eventId: await ingest(tenant, event), tenantId: tenant.tenantId });

  const invoicePaid = (customer: string, invoice: string, price = "price_sm", amount = 4900) => ({
    type: "invoice.paid",
    data: {
      object: { id: invoice, customer, subscription: `sub_${suffix}`, status: "paid", amount_paid: amount, currency: "usd", lines: { data: [{ price: { id: price } }] } },
    },
  });

  const periods = (tenant: SeedTenant) =>
    migrator.db.execute<{ method: string; period_start: string; period_end: string; amount_minor: string }>(
      sql`select method, period_start::text, period_end::text, amount_minor::text from subscription_payments where tenant_id = ${tenant.tenantId} order by period_start, period_end`,
    );
  const paidUntil = (tenant: SeedTenant) =>
    withTenant(app.db, tenant.tenantId, async (tx) => (await tx.execute<{ d: string | null }>(sql`select public.tenant_subscription_paid_until()::text as d`))[0]?.d ?? null);

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string);
    [A, B] = (await seedTenants(migrator, 2)) as [SeedTenant, SeedTenant];
    await migrator.db.execute(
      sql`insert into subscription_billing_accounts (tenant_id, stripe_customer_id) values (${A.tenantId}, ${customerA}), (${B.tenantId}, ${customerB})`,
    );
  });
  afterAll(async () => {
    if (migrator) {
      await dropTenants(migrator, [A, B].filter(Boolean).map((t) => t.tenantId));
      await migrator.close();
    }
    await app?.close();
  });

  it("settles a paid invoice once, grants 30 days and is idempotent on replay", async () => {
    expect(await paidUntil(A)).toBeNull();
    expect(await run(A, invoicePaid(customerA, `in_${suffix}1`))).toBe("paid");
    const first = await periods(A);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ method: "stripe", amount_minor: "4900" });
    const end = first[0]!.period_end;
    expect(await paidUntil(A)).toBe(end);

    // Same invoice again (webhook retry / reordering): no second period.
    expect(await run(A, invoicePaid(customerA, `in_${suffix}1`))).toBe("ignored");
    expect(await periods(A)).toHaveLength(1);

    const [charge] = await migrator.db.execute<{ status: string; verified_by: string; provider: string; plan: string; period_days: number }>(
      sql`select status, verified_by, provider, plan, period_days from subscription_charges where provider_payment_id = ${`in_${suffix}1`}`,
    );
    expect(charge).toMatchObject({ status: "paid", verified_by: "webhook", provider: "stripe", plan: "start", period_days: 30 });
  });

  it("stacks the renewal after the current period and switches the plan through the annual price", async () => {
    const before = (await periods(A))[0]!.period_end;
    expect(await run(A, invoicePaid(customerA, `in_${suffix}2`, "price_pa", 89000))).toBe("paid");
    const rows = await periods(A);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.period_start).toBe(before);
    expect(rows[1]!.amount_minor).toBe("89000");
  });

  it("never settles a wrong amount, an unknown price or an invoice that is not paid", async () => {
    const countBefore = (await periods(B)).length;
    expect(await run(B, invoicePaid(customerB, `in_${suffix}3`, "price_sm", 100))).toBe("amount_mismatch");
    expect(await run(B, invoicePaid(customerB, `in_${suffix}4`, "price_other"))).toBe("unknown_price");
    const open = invoicePaid(customerB, `in_${suffix}5`);
    (open.data.object as Record<string, unknown>)["status"] = "open";
    expect(await run(B, open)).toBe("not_paid");
    expect(await periods(B)).toHaveLength(countBefore);
    const errs = await migrator.db.execute<{ error: string | null }>(
      sql`select error from inbound_events where tenant_id = ${B.tenantId} and provider = 'stripe'::channel_provider order by received_at`,
    );
    expect(errs.map((e) => e.error)).toEqual(["amount_mismatch", "unknown_price", null]);
  });

  it("refuses an invoice of another tenant's customer", async () => {
    // Event stored under tenant B but naming tenant A's customer: the function only trusts B's own account.
    expect(await run(B, invoicePaid(customerA, `in_${suffix}6`))).toBe("unknown_customer");
    expect(await periods(B)).toHaveLength(0);
  });

  it("mirrors subscription state, ignores older reordered events and never touches access", async () => {
    const sub = (status: string, cancel: boolean) => ({
      type: "customer.subscription.updated",
      data: { object: { id: `sub_${suffix}`, customer: customerB, status, cancel_at_period_end: cancel, items: { data: [{ price: { id: "price_pm" }, current_period_end: 1_900_000_000 }] } } },
    });
    expect(await run(B, sub("active", true))).toBe("synced");
    // Older event id/time (created is lower than the one applied above): stale.
    const staleId = await ingest(B, sub("past_due", false));
    await migrator.db.execute(sql`update inbound_events set payload = jsonb_set(payload, '{created}', '1') where id = ${staleId}`);
    expect(await settleStripeBillingEvent(deps(), { eventId: staleId, tenantId: B.tenantId })).toBe("stale");
    const [acct] = await migrator.db.execute<{ status: string; plan: string; period: string; cancel_at_period_end: boolean }>(
      sql`select status, plan, period, cancel_at_period_end from subscription_billing_accounts where tenant_id = ${B.tenantId}`,
    );
    expect(acct).toMatchObject({ status: "active", plan: "pro", period: "monthly", cancel_at_period_end: true });
    expect(await paidUntil(B)).toBeNull();

    expect(await run(B, { type: "invoice.payment_failed", data: { object: { id: `in_${suffix}7`, customer: customerB, subscription: `sub_${suffix}` } } })).toBe("synced");
    expect(await run(B, { ...sub("canceled", true), type: "customer.subscription.deleted" })).toBe("synced");
    const [after] = await migrator.db.execute<{ status: string }>(sql`select status from subscription_billing_accounts where tenant_id = ${B.tenantId}`);
    expect(after?.status).toBe("canceled");
  });

  it("rejects job data that is not a tenant event", async () => {
    await expect(settleStripeBillingEvent(deps(), { eventId: "x", tenantId: A.tenantId })).rejects.toThrow();
    await expect(settleStripeBillingEvent(deps(), { eventId: randomUUID(), tenantId: A.tenantId })).rejects.toThrow();
  });
});
