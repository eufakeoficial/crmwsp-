import { randomUUID } from "node:crypto";
import {
  adAttributions,
  adSpend,
  adSpendDaily,
  channelConnections,
  contacts,
  conversations,
  createDb,
  dangerouslyWithoutTenant,
  orders,
  payments,
  tenants,
  usageLedger,
  withTenant,
  type DbHandle,
  type Transaction,
} from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProfitability } from "./profitability.service.js";

const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
const APP_URL = process.env["DATABASE_URL"];
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const must = <T>(row: T | undefined): T => {
  if (row === undefined) throw new Error("seed failed");
  return row;
};

describe.skipIf(!hasDb)("profitability report (app role, RLS)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const today = new Date().toISOString().slice(0, 10);
  let tenant = "";
  let other = "";
  let buyer = "";
  let lurker = "";

  async function seedTenant(tx: Transaction, label: string): Promise<{ tenant: string; conn: string }> {
    const id = must((await tx.insert(tenants).values({ slug: `prof-${label}-${suffix}`, name: label, currency: "USD", timezone: "UTC" }).returning({ id: tenants.id }))[0]).id;
    const conn = must(
      (await tx
        .insert(channelConnections)
        .values({ tenantId: id, provider: "gupshup", phoneE164: "+34600000001", webhookToken: `tok-prof-${label}-${randomUUID()}`, status: "active" })
        .returning({ id: channelConnections.id }))[0],
    ).id;
    return { tenant: id, conn };
  }

  async function order(tx: Transaction, tenantId: string, contactId: string, status: "paid" | "refunded", currency: string, total: bigint) {
    return must(
      (await tx
        .insert(orders)
        .values({
          tenantId,
          number: `O-${randomUUID().slice(0, 6)}`,
          contactId,
          status,
          currency,
          totalMinor: total,
          subtotalMinor: total,
          fulfillment: "service",
          createdByType: "user",
          paidAt: new Date(),
        })
        .returning({ id: orders.id }))[0],
    ).id;
  }

  async function payment(tx: Transaction, tenantId: string, orderId: string, currency: string, amount: bigint, verified: boolean) {
    await tx.insert(payments).values({
      tenantId,
      orderId,
      provider: "stripe",
      providerRef: `cs_${randomUUID()}`,
      url: "https://checkout.test",
      amountMinor: amount,
      currency,
      status: verified ? "succeeded" : "pending",
      verifiedBy: verified ? "webhook" : null,
      paidAt: verified ? new Date() : null,
    });
  }

  beforeAll(async () => {
    // The database is expected to be migrated already (`pnpm db:migrate`), as in the other API DB tests.
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 2 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const a = await seedTenant(tx, "a");
      tenant = a.tenant;
      buyer = must((await tx.insert(contacts).values({ tenantId: tenant, phoneE164: "+5491100000001", name: "Buyer" }).returning({ id: contacts.id }))[0]).id;
      lurker = must((await tx.insert(contacts).values({ tenantId: tenant, phoneE164: "+5491100000002", name: "Lurker" }).returning({ id: contacts.id }))[0]).id;
      const conv = must((await tx.insert(conversations).values({ tenantId: tenant, contactId: buyer, channelConnectionId: a.conn }).returning({ id: conversations.id }))[0]).id;
      const conv2 = must((await tx.insert(conversations).values({ tenantId: tenant, contactId: lurker, channelConnectionId: a.conn }).returning({ id: conversations.id }))[0]).id;

      // Verified USD revenue 1000; verified EUR revenue 700 (other currency); a "paid" order with only a
      // pending payment (unverified) and a refunded order must both be excluded.
      await payment(tx, tenant, await order(tx, tenant, buyer, "paid", "USD", 1000n), "USD", 1000n, true);
      await payment(tx, tenant, await order(tx, tenant, buyer, "paid", "EUR", 700n), "EUR", 700n, true);
      await payment(tx, tenant, await order(tx, tenant, buyer, "paid", "USD", 5000n), "USD", 5000n, false);
      await payment(tx, tenant, await order(tx, tenant, buyer, "refunded", "USD", 9000n), "USD", 9000n, true);

      const llm = (refId: string, micro: bigint) => ({
        tenantId: tenant,
        kind: "llm_tokens" as const,
        quantity: "1000",
        unit: "tokens",
        costMinor: micro,
        currency: "USD",
        refType: "conversation",
        refId,
        meta: { unit: "usd_microcents" },
      });
      await tx.insert(usageLedger).values([llm(conv, 30_000_000n), llm(conv2, 12_000_000n)]);
      await tx.insert(adAttributions).values({ tenantId: tenant, contactId: buyer, conversationId: conv, sourceId: "ad-1", firstSeenAt: new Date() });
      await tx.insert(adSpend).values({ tenantId: tenant, sourceId: "ad-1", currency: "USD", amountMinor: 200n });

      // Another tenant's revenue must never leak in.
      const b = await seedTenant(tx, "b");
      other = b.tenant;
      const c = must((await tx.insert(contacts).values({ tenantId: other, phoneE164: "+34611111111" }).returning({ id: contacts.id }))[0]).id;
      await payment(tx, other, await order(tx, other, c, "paid", "USD", 4242n), "USD", 4242n, true);
    });
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, async (tx) => {
        const { inArray } = await import("@crmwsp/db");
        await tx.delete(tenants).where(inArray(tenants.id, [tenant, other]));
      });
      await migrator.close();
    }
    if (app) await app.close();
  });

  const report = (q: Parameters<typeof loadProfitability>[2]) => withTenant(app.db, tenant, (tx) => loadProfitability(tx, tenant, q));

  it("counts only verified, non-refunded revenue in the report currency", async () => {
    const r = await report({ from: today, to: today, groupBy: "customer" });
    expect(r.currency).toBe("USD");
    expect(r.totals.revenueMinor).toBe(1000);
    expect(r.currencies).toEqual(["EUR", "USD"]);
    const row = must(r.rows.find((x) => x.contactId === buyer));
    expect(row.revenueMinor).toBe(1000);
    expect(row.aiCostMinor).toBe(30);
    expect(row.adSpendMinor).toBe(200);
    expect(row.marginMinor).toBe(1000 - 200 - 30);
  });

  it("keeps currencies separate and leaves USD usage costs out of a EUR margin", async () => {
    const r = await report({ from: today, to: today, currency: "EUR", groupBy: "customer" });
    expect(r.totals.revenueMinor).toBe(700);
    expect(r.usageCostsInMargin).toBe(false);
    expect(r.totals.adSpendMinor).toBe(0);
    expect(r.totals.marginMinor).toBe(700);
  });

  it("groups by order and by ad", async () => {
    const byOrder = await report({ from: today, to: today, groupBy: "order" });
    expect(byOrder.rows).toHaveLength(1);
    expect(byOrder.rows[0]?.revenueMinor).toBe(1000);
    const byAd = await report({ from: today, to: today, groupBy: "ad" });
    expect(byAd.rows).toHaveLength(1);
    expect(byAd.rows[0]?.adSourceId).toBe("ad-1");
    expect(byAd.rows[0]?.roasBp).toBe(50_000);
  });

  it("lists contacts that cost money but never converted", async () => {
    const r = await report({ from: today, to: today, groupBy: "customer" });
    expect(r.unconverted.map((u) => u.contactId)).toEqual([lurker]);
    expect(r.unconverted[0]?.usageCostMinor).toBe(12);
    expect(r.totals.conversations).toBe(2);
    expect(r.totals.costPerConversationMinor).toBe(21);
  });

  it("uses the daily synced spend of the range over the manual total for the same ad", async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx.insert(adSpendDaily).values([
        { tenantId: tenant, adId: "ad-1", date: today, spendMinor: 300, currency: "USD", adAccountId: "act_1" },
        { tenantId: tenant, adId: "ad-1", date: yesterday, spendMinor: 999, currency: "USD", adAccountId: "act_1" },
      ]),
    );
    const r = await report({ from: today, to: today, groupBy: "ad" });
    expect(r.rows[0]?.adSpendMinor).toBe(300);
    const wide = await report({ from: yesterday, to: today, groupBy: "ad" });
    expect(wide.rows[0]?.adSpendMinor).toBe(1299);
  });
});
