import { randomUUID } from "node:crypto";
import {
  adAttributions,
  adSpend,
  adSpendDaily,
  contacts,
  createDb,
  dangerouslyWithoutTenant,
  inArray,
  metaAdsConnections,
  orders,
  payments,
  tenants,
  withTenant,
  type DbHandle,
  type Transaction,
} from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adReport } from "./ads.queries.js";

const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
const APP_URL = process.env["DATABASE_URL"];
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const must = <T>(row: T | undefined): T => {
  if (row === undefined) throw new Error("seed failed");
  return row;
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasDb)("ads report with daily Meta spend (app role, RLS)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let tenant = "";
  let other = "";

  async function buyer(tx: Transaction, phone: string, adId: string, paid: { currency: string; total: bigint; verified: boolean } | null) {
    const c = must((await tx.insert(contacts).values({ tenantId: tenant, phoneE164: phone }).returning({ id: contacts.id }))[0]).id;
    await tx.insert(adAttributions).values({ tenantId: tenant, contactId: c, sourceId: adId, firstSeenAt: new Date() });
    if (!paid) return;
    const o = must(
      (await tx
        .insert(orders)
        .values({
          tenantId: tenant,
          number: `O-${randomUUID().slice(0, 6)}`,
          contactId: c,
          status: "paid",
          currency: paid.currency,
          totalMinor: paid.total,
          subtotalMinor: paid.total,
          fulfillment: "service",
          createdByType: "user",
          paidAt: new Date(),
        })
        .returning({ id: orders.id }))[0],
    ).id;
    await tx.insert(payments).values({
      tenantId: tenant,
      orderId: o,
      provider: "stripe",
      providerRef: `cs_${randomUUID()}`,
      url: "https://checkout.test",
      amountMinor: paid.total,
      currency: paid.currency,
      status: paid.verified ? "succeeded" : "pending",
      verifiedBy: paid.verified ? "webhook" : null,
      paidAt: paid.verified ? new Date() : null,
    });
  }

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 2 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      tenant = must((await tx.insert(tenants).values({ slug: `adsr-a-${suffix}`, name: "a", currency: "EUR", timezone: "UTC" }).returning({ id: tenants.id }))[0]).id;
      other = must((await tx.insert(tenants).values({ slug: `adsr-b-${suffix}`, name: "b", currency: "EUR", timezone: "UTC" }).returning({ id: tenants.id }))[0]).id;
      await tx.insert(metaAdsConnections).values({ tenantId: tenant, adAccountId: "act_1", currency: "EUR", accessTokenEncrypted: Buffer.from("x"), minConversations: 1, minSpendMinor: 100 });
      // ad-1 (campaign c1): synced daily EUR spend for 7 days (10.00/day), plus a manual total that must be ignored.
      const daily = Array.from({ length: 7 }, (_, i) => ({
        tenantId: tenant,
        adId: "ad-1",
        date: day(-i),
        spendMinor: 1000,
        currency: "EUR",
        impressions: 100,
        clicks: 5,
        adAccountId: "act_1",
        adName: "Ad uno",
        adsetId: "s1",
        adsetName: "Set uno",
        campaignId: "c1",
        campaignName: "Campaña uno",
      }));
      await tx.insert(adSpendDaily).values(daily);
      await tx.insert(adSpend).values({ tenantId: tenant, sourceId: "ad-1", currency: "EUR", amountMinor: 99_999n });
      // ad-2 (same campaign): synced spend only, old day outside the default range too.
      await tx.insert(adSpendDaily).values([
        { tenantId: tenant, adId: "ad-2", date: day(0), spendMinor: 500, currency: "EUR", adAccountId: "act_1", adsetId: "s2", campaignId: "c1", campaignName: "Campaña uno" },
        { tenantId: tenant, adId: "ad-2", date: day(-60), spendMinor: 7777, currency: "EUR", adAccountId: "act_1", adsetId: "s2", campaignId: "c1", campaignName: "Campaña uno" },
      ]);
      // ad-3: manual only, in USD, with EUR revenue (no ROAS across currencies).
      await tx.insert(adSpend).values({ tenantId: tenant, sourceId: "ad-3", currency: "USD", amountMinor: 3000n, label: "Manual" });

      await buyer(tx, "+5491100000001", "ad-1", { currency: "EUR", total: 30_000n, verified: true });
      await buyer(tx, "+5491100000002", "ad-1", { currency: "EUR", total: 50_000n, verified: false });
      await buyer(tx, "+5491100000003", "ad-3", { currency: "EUR", total: 4_000n, verified: true });

      // Another tenant's spend never leaks.
      await tx.insert(adSpendDaily).values({ tenantId: other, adId: "ad-1", date: day(0), spendMinor: 123_456, currency: "EUR", adAccountId: "act_9" });
    });
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(tenants).where(inArray(tenants.id, [tenant, other])));
      await migrator.close();
    }
    if (app) await app.close();
  });

  const report = (q: Parameters<typeof adReport>[2]) => withTenant(app.db, tenant, (tx) => adReport(tx, tenant, q));

  it("per ad: daily spend wins over manual, verified revenue only, cost metrics and recommendation", async () => {
    const r = await report({});
    expect(r.groupBy).toBe("ad");
    expect(r.to).toBe(day(0));
    const ad1 = must(r.items.find((i) => i.sourceId === "ad-1"));
    expect(ad1.spendSource).toBe("daily");
    expect(ad1.label).toBe("Ad uno");
    expect(ad1.conversations).toBe(2);
    expect(ad1.paidOrders).toBe(1);
    expect(ad1.impressions).toBe(700);
    expect(ad1.byCurrency).toEqual([
      { currency: "EUR", revenueMinor: 30_000, spendMinor: 7000, roas: 4.29, costPerConversationMinor: 3500, costPerPurchaseMinor: 7000 },
    ]);
    expect(ad1.recommendation.action).toBe("scale");
    expect(ad1.recommendation.reason).toContain("70.00 EUR");
    // Spend outside the range is excluded.
    expect(must(r.items.find((i) => i.sourceId === "ad-2")).byCurrency[0]?.spendMinor).toBe(500);
  });

  it("never converts currencies: USD manual spend and EUR revenue stay on separate lines", async () => {
    const ad3 = must((await report({})).items.find((i) => i.sourceId === "ad-3"));
    expect(ad3.spendSource).toBe("manual");
    expect(ad3.label).toBe("Manual");
    expect(ad3.byCurrency.map((c) => [c.currency, c.revenueMinor, c.spendMinor, c.roas])).toEqual([
      ["EUR", 4000, 0, null],
      ["USD", 0, 3000, 0],
    ]);
    expect(ad3.recommendation.action).toBe("observe");
  });

  it("groups by campaign and by adset", async () => {
    const byCampaign = await report({ groupBy: "campaign" });
    const c1 = must(byCampaign.items.find((i) => i.sourceId === "c1"));
    expect(c1.label).toBe("Campaña uno");
    expect(c1.byCurrency[0]?.spendMinor).toBe(7500);
    expect(c1.conversations).toBe(2);
    expect(byCampaign.items.find((i) => i.sourceId === "unknown")?.byCurrency.find((c) => c.currency === "USD")?.spendMinor).toBe(3000);
    const byAdset = await report({ groupBy: "adset" });
    expect(byAdset.items.map((i) => i.sourceId).sort()).toEqual(["s1", "s2", "unknown"]);
  });

  it("honours the date range", async () => {
    const r = await report({ from: day(-1), to: day(0) });
    expect(must(r.items.find((i) => i.sourceId === "ad-1")).byCurrency[0]?.spendMinor).toBe(2000);
  });
});
