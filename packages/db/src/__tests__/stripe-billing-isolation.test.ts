import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { subscriptionBillingAccounts, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

describe.skipIf(!hasDb)("Stripe billing accounts (card billing, ADR 0022): isolation and SECURITY DEFINER functions", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const customerA = `cus_A${suffix}`;
  const customerB = `cus_B${suffix}`;
  let tenantA = "";
  let tenantB = "";

  const attach = (tenantId: string, customer: string) =>
    withTenant(app.db, tenantId, async (tx) => (await tx.execute<{ id: string }>(sql`select public.stripe_billing_account_attach(${customer}) as id`))[0]?.id);

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a, b] = await tx
        .insert(tenants)
        .values([
          { slug: `stripe-a-${suffix}`, name: "Stripe A" },
          { slug: `stripe-b-${suffix}`, name: "Stripe B" },
        ])
        .returning({ id: tenants.id });
      if (!a || !b) throw new Error("seed failed");
      tenantA = a.id;
      tenantB = b.id;
    });
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, async (tx) => {
        await tx.delete(tenants).where(inArray(tenants.id, [tenantA, tenantB].filter(Boolean)));
      });
      await migrator.close();
    }
    await app?.close();
  });

  it("each tenant sees only its own billing account and the attach is once per tenant", async () => {
    expect(await attach(tenantA, customerA)).toBe(customerA);
    expect(await attach(tenantB, customerB)).toBe(customerB);
    // A second attach (race loser) returns the stored customer, never replaces it.
    expect(await attach(tenantA, `cus_other${suffix}`)).toBe(customerA);

    const seenByA = await withTenant(app.db, tenantA, (tx) => tx.select().from(subscriptionBillingAccounts));
    expect(seenByA.map((r) => r.stripeCustomerId)).toEqual([customerA]);
    const seenByB = await withTenant(app.db, tenantB, (tx) => tx.select({ id: subscriptionBillingAccounts.id }).from(subscriptionBillingAccounts).where(eq(subscriptionBillingAccounts.stripeCustomerId, customerA)));
    expect(seenByB).toEqual([]);
  });

  it("the app role can read but never write the table (no self-service subscription state)", async () => {
    const insert = await settle(
      withTenant(app.db, tenantA, (tx) => tx.insert(subscriptionBillingAccounts).values({ tenantId: tenantA, stripeCustomerId: `cus_x${suffix}` })),
    );
    expect(insert).toBeDefined();
    const update = await settle(
      withTenant(app.db, tenantA, (tx) => tx.update(subscriptionBillingAccounts).set({ status: "active" }).where(eq(subscriptionBillingAccounts.tenantId, tenantA))),
    );
    expect(update).toBeDefined();
    const del = await settle(withTenant(app.db, tenantA, (tx) => tx.delete(subscriptionBillingAccounts)));
    expect(del).toBeDefined();
    const [row] = await withTenant(app.db, tenantA, (tx) => tx.select().from(subscriptionBillingAccounts));
    expect(row?.status).toBe("none");
  });

  it("rejects malformed customer ids and refuses to attach without a tenant context", async () => {
    expect(await settle(attach(tenantA, "not-a-customer"))).toBeDefined();
    const noTenant = await settle(dangerouslyWithoutTenant(app.db, (tx) => tx.execute(sql`select public.stripe_billing_account_attach(${`cus_n${suffix}`})`)));
    expect(noTenant).toBeDefined();
  });

  it("ingests an event under the tenant of the customer, deduplicates, and drops unknown customers", async () => {
    const key = `stripe_billing:evt_${suffix}`;
    const ingest = (customer: string, k = key) =>
      dangerouslyWithoutTenant(app.db, async (tx) => {
        const rows = await tx.execute<{ event_id: string; tenant_id: string; inserted: boolean }>(
          sql`select event_id, tenant_id, inserted from public.ingest_stripe_billing_event(${k}, ${customer}, ${JSON.stringify({ id: "evt" })}::jsonb)`,
        );
        return rows[0];
      });
    const first = await ingest(customerA);
    expect(first).toMatchObject({ tenant_id: tenantA, inserted: true });
    const again = await ingest(customerA);
    expect(again).toMatchObject({ tenant_id: tenantA, inserted: false, event_id: first?.event_id });
    expect(await ingest(`cus_unknown${suffix}`, `${key}-2`)).toBeUndefined();
    // Wrong prefix is rejected outright.
    expect(await settle(ingest(customerA, "nowpayments:1"))).toBeDefined();
    // The event is visible only to its tenant.
    const visibleToB = await withTenant(app.db, tenantB, (tx) => tx.execute(sql`select id from inbound_events where dedupe_key = ${key}`));
    expect(visibleToB).toHaveLength(0);
  });

  it("the settle function enforces its own invariants (customer ownership, plan, amount, idempotency)", async () => {
    const settleInvoice = (tenantId: string, customer: string, invoice: string, plan = "start", days = 30, amount = 4900) =>
      withTenant(app.db, tenantId, async (tx) => {
        const rows = await tx.execute<{ outcome: string }>(
          sql`select outcome from public.stripe_invoice_settle(${customer}, ${invoice}, null, ${plan}, ${days}::integer, ${amount}::bigint, 'usd')`,
        );
        return rows[0]?.outcome;
      });
    expect(await settleInvoice(tenantA, customerB, `in_${suffix}x`)).toBe("unknown_customer");
    expect(await settle(settleInvoice(tenantA, customerA, `in_${suffix}y`, "enterprise"))).toBeDefined();
    expect(await settle(settleInvoice(tenantA, customerA, `in_${suffix}y`, "start", 31))).toBeDefined();
    expect(await settle(settleInvoice(tenantA, customerA, `in_${suffix}y`, "start", 30, 0))).toBeDefined();
    expect(await settleInvoice(tenantA, customerA, `in_${suffix}z`)).toBe("paid");
    expect(await settleInvoice(tenantA, customerA, `in_${suffix}z`)).toBe("ignored");
    const [paid] = await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from subscription_payments where tenant_id = ${tenantA} and method = 'stripe'`),
    );
    expect(paid?.n).toBe(1);
  });
});
