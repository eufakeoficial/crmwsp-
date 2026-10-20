import type { AdReport, AdReportGroupBy, AdReportQuery, AdReportRow } from "@crmwsp/contracts";
import {
  AD_STABILITY_DAYS,
  DEFAULT_AD_RECOMMENDATION_THRESHOLDS,
  computeRoas,
  costPerMinor,
  recommendAd,
  type AdRecommendationThresholds,
  type AdWindowStats,
  type CurrencyMinor,
} from "@crmwsp/domain";
import { eq, metaAdsConnections, sql, tenants, type Transaction } from "@crmwsp/db";
import { addDays, resolveRange } from "../metrics/range.js";

const UNKNOWN = "unknown";
const toNum = (v: number | string | null | undefined) => Number(v ?? 0);
const rows = <T>(r: unknown): T[] => r as T[];

/** Per-ad CRM outcomes of the contacts first attributed to the ad inside a window. */
interface AttrAgg {
  conversations: number;
  orders: number;
  paidOrders: number;
  headline: string | null;
  sourceUrl: string | null;
  revenue: CurrencyMinor[];
}
interface DailyRow {
  ad_id: string;
  date: string;
  currency: string;
  spend: string;
  impressions: string;
  clicks: string;
}
interface AdMeta {
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

/**
 * Attribution outcomes for contacts whose first ad touch is in [lo, hi). Revenue counts ONLY
 * orders backed by a succeeded payment with verified_by IN ('webhook', 'reconciliation');
 * manually marked orders count as orders, never as paid revenue. RLS scopes every table.
 */
async function attributionWindow(tx: Transaction, lo: ReturnType<typeof sql>, hi: ReturnType<typeof sql>): Promise<Map<string, AttrAgg>> {
  const [agg, revenue] = await Promise.all([
    tx.execute(sql`
      select coalesce(a.source_id, ${UNKNOWN}) as source_id,
             max(a.headline) as headline,
             max(a.source_url) as source_url,
             count(distinct coalesce(a.conversation_id, a.contact_id)) as conversations,
             count(distinct o.id) filter (where o.status not in ('draft', 'cancelled')) as orders,
             count(distinct o.id) filter (where vp.order_id is not null) as paid_orders
      from ad_attributions a
      left join orders o on o.tenant_id = a.tenant_id and o.contact_id = a.contact_id
      left join (
        select distinct p.order_id from payments p
        where p.status = 'succeeded' and p.verified_by in ('webhook', 'reconciliation')
      ) vp on vp.order_id = o.id
      where a.first_seen_at >= ${lo} and a.first_seen_at < ${hi}
      group by 1`),
    tx.execute(sql`
      select coalesce(a.source_id, ${UNKNOWN}) as source_id, o.currency::text as currency, sum(o.total_minor)::text as amount_minor
      from ad_attributions a
      join orders o on o.tenant_id = a.tenant_id and o.contact_id = a.contact_id
      where a.first_seen_at >= ${lo} and a.first_seen_at < ${hi}
        and o.status in ('paid', 'fulfilled', 'shipped', 'delivered')
        and exists (
          select 1 from payments p
          where p.order_id = o.id and p.status = 'succeeded' and p.verified_by in ('webhook', 'reconciliation'))
      group by 1, 2`),
  ]);
  const out = new Map<string, AttrAgg>();
  for (const r of rows<{ source_id: string; headline: string | null; source_url: string | null; conversations: string; orders: string; paid_orders: string }>(agg)) {
    out.set(r.source_id, {
      conversations: toNum(r.conversations),
      orders: toNum(r.orders),
      paidOrders: toNum(r.paid_orders),
      headline: r.headline,
      sourceUrl: r.source_url,
      revenue: [],
    });
  }
  for (const r of rows<{ source_id: string; currency: string; amount_minor: string }>(revenue)) {
    out.get(r.source_id)?.revenue.push({ currency: r.currency.trim(), amountMinor: toNum(r.amount_minor) });
  }
  return out;
}

interface Group {
  key: string;
  label: string | null;
  headline: string | null;
  sourceUrl: string | null;
  campaignName: string | null;
  adsetName: string | null;
  conversations: number;
  orders: number;
  paidOrders: number;
  impressions: number;
  clicks: number;
  revenue: CurrencyMinor[];
  dailySpend: CurrencyMinor[];
  manualSpend: CurrencyMinor[];
  hasDaily: boolean;
  hasManual: boolean;
  last7: { conversations: number; paidOrders: number; revenue: CurrencyMinor[]; spend: CurrencyMinor[]; dates: Set<string> };
}

const sumCur = (xs: CurrencyMinor[], c: string) => xs.filter((x) => x.currency === c).reduce((a, x) => a + x.amountMinor, 0);

export async function loadThresholds(tx: Transaction): Promise<AdRecommendationThresholds> {
  const [c] = await tx
    .select({
      targetRoasBp: metaAdsConnections.targetRoasBp,
      breakEvenRoasBp: metaAdsConnections.breakEvenRoasBp,
      minSpendMinor: metaAdsConnections.minSpendMinor,
      minConversations: metaAdsConnections.minConversations,
      pauseSpendMinor: metaAdsConnections.pauseSpendMinor,
    })
    .from(metaAdsConnections)
    .limit(1);
  return c ?? DEFAULT_AD_RECOMMENDATION_THRESHOLDS;
}

/**
 * Report for [from, to] (tenant days) grouped by campaign, adset or ad. Spend: the daily Meta
 * sync for the range; ads never synced fall back to their manual (undated) total. ROAS and cost
 * metrics only within one currency; spend and revenue in different currencies are never converted.
 */
export async function adReport(tx: Transaction, tenantId: string, query: AdReportQuery): Promise<AdReport> {
  const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  const tz = t?.tz || "UTC";
  const groupBy: AdReportGroupBy = query.groupBy ?? "ad";
  const [today] = rows<{ d: string }>(await tx.execute(sql`select (now() at time zone ${tz})::date::text as d`));
  const { from, to } = resolveRange(query.from, query.to, today?.d ?? new Date().toISOString().slice(0, 10));
  const from7 = addDays(to, -(AD_STABILITY_DAYS - 1)) > from ? addDays(to, -(AD_STABILITY_DAYS - 1)) : from;
  const bound = (day: string) => sql`((${day}::date)::timestamp at time zone ${tz})`;
  const hi = sql`(((${to}::date + 1))::timestamp at time zone ${tz})`;

  const [attr, attr7, daily, everDaily, manual, metaRows, thresholds] = await Promise.all([
    attributionWindow(tx, bound(from), hi),
    attributionWindow(tx, bound(from7), hi),
    tx.execute(sql`
      select ad_id, date::text as date, currency::text as currency, sum(spend_minor)::text as spend,
             sum(impressions)::text as impressions, sum(clicks)::text as clicks
      from ad_spend_daily where date >= ${from}::date and date <= ${to}::date
      group by 1, 2, 3`),
    tx.execute(sql`select distinct ad_id from ad_spend_daily`),
    tx.execute(sql`select source_id, currency::text as currency, amount_minor::text as amount_minor, label from ad_spend`),
    tx.execute(sql`
      select distinct on (ad_id) ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name
      from ad_spend_daily order by ad_id, date desc`),
    loadThresholds(tx),
  ]);

  const synced = new Set(rows<{ ad_id: string }>(everDaily).map((r) => r.ad_id));
  const meta = new Map<string, AdMeta>(
    rows<{ ad_id: string; ad_name: string | null; adset_id: string | null; adset_name: string | null; campaign_id: string | null; campaign_name: string | null }>(metaRows).map((r) => [
      r.ad_id,
      { adName: r.ad_name, adsetId: r.adset_id, adsetName: r.adset_name, campaignId: r.campaign_id, campaignName: r.campaign_name },
    ]),
  );
  const manualRows = rows<{ source_id: string; currency: string; amount_minor: string; label: string | null }>(manual).filter((r) => !synced.has(r.source_id));
  const dailyRows = rows<DailyRow>(daily);

  const keyOf = (adId: string): string => {
    if (groupBy === "ad") return adId;
    const m = meta.get(adId);
    return (groupBy === "adset" ? m?.adsetId : m?.campaignId) ?? UNKNOWN;
  };
  const groups = new Map<string, Group>();
  const group = (adId: string): Group => {
    const key = keyOf(adId);
    let g = groups.get(key);
    if (!g) {
      const m = meta.get(adId);
      const isUnknown = key === UNKNOWN;
      g = {
        key,
        label: isUnknown ? null : groupBy === "ad" ? (m?.adName ?? null) : groupBy === "adset" ? (m?.adsetName ?? null) : (m?.campaignName ?? null),
        headline: null,
        sourceUrl: null,
        campaignName: isUnknown ? null : (m?.campaignName ?? null),
        adsetName: isUnknown || groupBy === "campaign" ? null : (m?.adsetName ?? null),
        conversations: 0,
        orders: 0,
        paidOrders: 0,
        impressions: 0,
        clicks: 0,
        revenue: [],
        dailySpend: [],
        manualSpend: [],
        hasDaily: false,
        hasManual: false,
        last7: { conversations: 0, paidOrders: 0, revenue: [], spend: [], dates: new Set() },
      };
      groups.set(key, g);
    }
    return g;
  };

  for (const [adId, a] of attr) {
    const g = group(adId);
    g.conversations += a.conversations;
    g.orders += a.orders;
    g.paidOrders += a.paidOrders;
    g.revenue.push(...a.revenue);
    if (groupBy === "ad") {
      g.headline = a.headline;
      g.sourceUrl = a.sourceUrl;
    }
  }
  for (const [adId, a] of attr7) {
    const g = group(adId);
    g.last7.conversations += a.conversations;
    g.last7.paidOrders += a.paidOrders;
    g.last7.revenue.push(...a.revenue);
  }
  for (const r of dailyRows) {
    const g = group(r.ad_id);
    const spend = { currency: r.currency.trim(), amountMinor: toNum(r.spend) };
    g.hasDaily = true;
    g.dailySpend.push(spend);
    g.impressions += toNum(r.impressions);
    g.clicks += toNum(r.clicks);
    if (r.date >= from7) {
      g.last7.spend.push(spend);
      g.last7.dates.add(r.date);
    }
  }
  for (const r of manualRows) {
    const g = group(r.source_id);
    g.hasManual = true;
    g.manualSpend.push({ currency: r.currency.trim(), amountMinor: toNum(r.amount_minor) });
    if (groupBy === "ad" && !g.label && r.label) g.label = r.label;
  }

  const items = [...groups.values()].map((g): AdReportRow => {
    const spend = [...g.dailySpend, ...g.manualSpend];
    const byCurrency = computeRoas(g.revenue, spend).map((c) => ({
      ...c,
      costPerConversationMinor: c.spendMinor > 0 ? costPerMinor(c.spendMinor, g.conversations) : null,
      costPerPurchaseMinor: c.spendMinor > 0 ? costPerMinor(c.spendMinor, g.paidOrders) : null,
    }));
    const dailyCurrency = [...new Set(g.dailySpend.map((s) => s.currency))].sort((a, b) => sumCur(g.dailySpend, b) - sumCur(g.dailySpend, a))[0];
    const currency = dailyCurrency ?? spend[0]?.currency ?? g.revenue[0]?.currency ?? "EUR";
    const window = (spendRows: CurrencyMinor[], revenue: CurrencyMinor[], purchases: number, conversations: number): AdWindowStats => ({
      spendMinor: sumCur(spendRows, currency),
      revenueMinor: sumCur(revenue, currency),
      purchases,
      conversations,
    });
    const recommendation = recommendAd(
      {
        currency,
        hasDailySpend: g.hasDaily,
        otherRevenueCurrencies: [...new Set(g.revenue.filter((r) => r.currency !== currency && r.amountMinor > 0).map((r) => r.currency))].sort(),
        period: window(g.dailySpend, g.revenue, g.paidOrders, g.conversations),
        last7: window(g.last7.spend, g.last7.revenue, g.last7.paidOrders, g.last7.conversations),
        last7DaysWithData: g.last7.dates.size,
      },
      thresholds,
    );
    return {
      sourceId: g.key,
      level: groupBy,
      label: g.label,
      headline: g.headline,
      sourceUrl: g.sourceUrl,
      campaignName: g.campaignName,
      adsetName: g.adsetName,
      conversations: g.conversations,
      orders: g.orders,
      paidOrders: g.paidOrders,
      impressions: g.impressions,
      clicks: g.clicks,
      spendSource: g.hasDaily && g.hasManual ? "mixed" : g.hasDaily ? "daily" : g.hasManual ? "manual" : null,
      byCurrency,
      recommendation,
    };
  });
  items.sort((x, y) => y.conversations - x.conversations || x.sourceId.localeCompare(y.sourceId));
  return { from, to, groupBy, items };
}
