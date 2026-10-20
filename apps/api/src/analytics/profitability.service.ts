import type { Profitability, ProfitabilityQuery, ProfitabilityRow, UnconvertedContact } from "@crmwsp/contracts";
import {
  DEFAULT_TTS_USD_MICRO_PER_CHAR,
  USAGE_COST_CURRENCY,
  allocateEvenly,
  marginMinor,
  microToCents,
  perUnit,
  resolveWhatsappRates,
  roasBp,
  whatsappRateFor,
} from "@crmwsp/domain";
import { eq, sql, tenants, type Transaction } from "@crmwsp/db";
import { resolveRange } from "../metrics/range.js";
import { toNumReq } from "../sales/util.js";

/** Revenue = provider-verified succeeded payments only (never a receipt image), net of refunded orders. */
const VERIFIED_PAYMENT = sql`p.status = 'succeeded' and p.verified_by in ('webhook', 'reconciliation') and o.status <> 'refunded'`;
const AI_KINDS = sql`('llm_tokens', 'embedding_tokens', 'transcription_seconds')`;
const MAX_ROWS = 200;
const RANK_SIZE = 5;

const rows = <T>(r: unknown): T[] => r as T[];

interface ContactAgg {
  contactId: string;
  revenueMinor: number;
  orders: Map<string, number>;
  aiMicro: number;
  ttsChars: number;
  waMicro: number;
  conversations: number;
  adSpendMinor: number;
  adSourceId: string | null;
}

interface Costs {
  adSpendMinor: number;
  aiCostMinor: number;
  ttsCostMinor: number;
  whatsappCostMinor: number;
}

const usageOf = (c: Costs): number => c.aiCostMinor + c.ttsCostMinor + c.whatsappCostMinor;

/** Read-only profitability report for [from, to] (tenant time zone). Runs inside the tenant RLS transaction. */
export async function loadProfitability(tx: Transaction, tenantId: string, query: ProfitabilityQuery): Promise<Profitability> {
  const [t] = await tx
    .select({ tz: tenants.timezone, currency: tenants.currency, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const tz = t?.tz || "UTC";
  const currency = query.currency ?? t?.currency ?? "EUR";
  const groupBy = query.groupBy ?? "customer";
  const { rates, source: whatsappRatesSource } = resolveWhatsappRates(t?.settings);
  const [today] = rows<{ d: string }>(await tx.execute(sql`select (now() at time zone ${tz})::date::text as d`));
  const { from, to } = resolveRange(query.from, query.to, today?.d ?? new Date().toISOString().slice(0, 10));
  const lo = sql`((${from}::date)::timestamp at time zone ${tz})`;
  const hi = sql`(((${to}::date + 1))::timestamp at time zone ${tz})`;

  const [revenue, currencies, usage, whatsapp, attributions, won] = await Promise.all([
    tx.execute(sql`
      select o.contact_id::text as contact_id, o.id::text as order_id, sum(p.amount_minor)::text as minor
      from payments p join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id
      where ${VERIFIED_PAYMENT} and p.currency = ${currency} and p.paid_at >= ${lo} and p.paid_at < ${hi}
      group by 1, 2`),
    tx.execute(sql`
      select distinct p.currency::text as currency
      from payments p join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id
      where ${VERIFIED_PAYMENT} and p.paid_at >= ${lo} and p.paid_at < ${hi}
      union select distinct currency::text from ad_spend
      union select distinct currency::text from ad_spend_daily where date >= ${from}::date and date <= ${to}::date`),
    tx.execute(sql`
      select coalesce(c1.contact_id, c2.contact_id)::text as contact_id,
             coalesce(sum(u.cost_minor) filter (where u.kind in ${AI_KINDS} and u.currency = 'USD' and u.meta->>'unit' = 'usd_microcents'), 0)::text as ai_micro,
             coalesce(sum(u.quantity) filter (where u.kind = 'tts_characters'), 0)::text as tts_chars,
             count(distinct coalesce(c1.id, c2.id))::int as conversations
      from usage_ledger u
      left join conversations c1 on u.ref_type = 'conversation' and c1.tenant_id = u.tenant_id and c1.id = u.ref_id
      left join messages m on u.ref_type = 'message' and m.tenant_id = u.tenant_id and m.id = u.ref_id
      left join conversations c2 on c2.tenant_id = m.tenant_id and c2.id = m.conversation_id
      where u.occurred_at >= ${lo} and u.occurred_at < ${hi} and coalesce(c1.contact_id, c2.contact_id) is not null
      group by 1`),
    tx.execute(sql`
      select c.contact_id::text as contact_id, ct.phone_e164 as phone, count(*)::int as n
      from messages m
      join conversations c on c.tenant_id = m.tenant_id and c.id = m.conversation_id
      join contacts ct on ct.tenant_id = c.tenant_id and ct.id = c.contact_id
      where m.direction = 'outbound' and m.status <> 'failed' and m.created_at >= ${lo} and m.created_at < ${hi}
        and (m.template_id is not null
             or exists (select 1 from broadcast_recipients br where br.tenant_id = m.tenant_id and br.message_id = m.id))
      group by 1, 2`),
    tx.execute(sql`
      with spend as (
        select d.ad_id as source_id, sum(d.spend_minor)::bigint as amount_minor, true as dated
        from ad_spend_daily d
        where d.currency = ${currency} and d.date >= ${from}::date and d.date <= ${to}::date
        group by 1
        union all
        select s.source_id, s.amount_minor, false as dated
        from ad_spend s
        where s.currency = ${currency}
          and not exists (select 1 from ad_spend_daily d where d.tenant_id = s.tenant_id and d.ad_id = s.source_id)
      )
      select a.contact_id::text as contact_id, a.source_id, s.amount_minor::text as spend,
             count(*) over (partition by a.source_id)::int as n
      from ad_attributions a join spend s on s.source_id = a.source_id
      where a.source_id is not null
        and (not s.dated or (a.first_seen_at >= ${lo} and a.first_seen_at < ${hi}))
      order by a.source_id, a.first_seen_at, a.contact_id`),
    tx.execute(sql`
      select count(*)::int as n from quotes
      where status = 'accepted' and currency = ${currency} and accepted_at >= ${lo} and accepted_at < ${hi}`),
  ]);

  const byContact = new Map<string, ContactAgg>();
  const agg = (contactId: string): ContactAgg => {
    let a = byContact.get(contactId);
    if (!a) {
      a = { contactId, revenueMinor: 0, orders: new Map(), aiMicro: 0, ttsChars: 0, waMicro: 0, conversations: 0, adSpendMinor: 0, adSourceId: null };
      byContact.set(contactId, a);
    }
    return a;
  };
  for (const r of rows<{ contact_id: string; order_id: string; minor: string }>(revenue)) {
    const a = agg(r.contact_id);
    const v = toNumReq(r.minor);
    a.revenueMinor += v;
    a.orders.set(r.order_id, v);
  }
  for (const r of rows<{ contact_id: string; ai_micro: string; tts_chars: string; conversations: number }>(usage)) {
    const a = agg(r.contact_id);
    a.aiMicro += Number(r.ai_micro);
    a.ttsChars += Math.ceil(Number(r.tts_chars));
    a.conversations += r.conversations;
  }
  for (const r of rows<{ contact_id: string; phone: string; n: number }>(whatsapp)) {
    agg(r.contact_id).waMicro += r.n * whatsappRateFor(r.phone, rates);
  }

  // Dated spend (daily Meta sync, precedence for the same ad): the range's spend is split evenly
  // across the ad's contacts first attributed in the range. Manual spend has no date: each ad's
  // total is split across ALL its first-touch contacts; only the shares of contacts active in the
  // range are reported (estimate).
  const ads = new Map<string, { spendMinor: number; contacts: string[] }>();
  const attribution = rows<{ contact_id: string; source_id: string; spend: string; n: number }>(attributions);
  for (let i = 0; i < attribution.length; ) {
    const first = attribution[i] as (typeof attribution)[number];
    const group = attribution.slice(i, i + first.n);
    const spend = toNumReq(first.spend);
    const shares = allocateEvenly(spend, group.length);
    ads.set(first.source_id, { spendMinor: spend, contacts: group.map((g) => g.contact_id) });
    group.forEach((g, k) => {
      const a = byContact.get(g.contact_id);
      if (a) {
        a.adSpendMinor += shares[k] ?? 0;
        a.adSourceId = g.source_id;
      }
    });
    i += Math.max(1, first.n);
  }

  const contactIds = [...byContact.keys()];
  const idList = contactIds.join(",");
  const [labels, everPaid] = contactIds.length
    ? await Promise.all([
        tx.execute(sql`
          select id::text as id, coalesce(nullif(name, ''), phone_e164) as label
          from contacts where id = any(string_to_array(${idList}, ',')::uuid[])`),
        tx.execute(sql`
          select distinct o.contact_id::text as contact_id
          from payments p join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id
          where ${VERIFIED_PAYMENT} and o.contact_id = any(string_to_array(${idList}, ',')::uuid[])`),
      ])
    : [[], []];
  const labelOf = new Map(rows<{ id: string; label: string }>(labels).map((r) => [r.id, r.label]));
  const paidEver = new Set(rows<{ contact_id: string }>(everPaid).map((r) => r.contact_id));

  const costsOf = (a: ContactAgg): Costs => ({
    adSpendMinor: a.adSpendMinor,
    aiCostMinor: microToCents(a.aiMicro),
    ttsCostMinor: microToCents(a.ttsChars * DEFAULT_TTS_USD_MICRO_PER_CHAR),
    whatsappCostMinor: microToCents(a.waMicro),
  });
  const row = (
    base: { key: string; label: string; contactId: string | null; orderId: string | null; adSourceId: string | null },
    revenueMinor: number,
    costs: Costs,
    conversations: number,
    withRoas: boolean,
  ): ProfitabilityRow => ({
    ...base,
    ...costs,
    revenueMinor,
    conversations,
    marginMinor: marginMinor({ currency, revenueMinor, adSpendMinor: costs.adSpendMinor, usageCostMinor: usageOf(costs) }),
    roasBp: withRoas ? roasBp(revenueMinor, costs.adSpendMinor) : null,
  });

  const customerRows = [...byContact.values()].map((a) =>
    row(
      { key: a.contactId, label: labelOf.get(a.contactId) ?? a.contactId, contactId: a.contactId, orderId: null, adSourceId: a.adSourceId },
      a.revenueMinor,
      costsOf(a),
      a.conversations,
      false,
    ),
  );
  const customerById = new Map(customerRows.map((r) => [r.key, r]));

  let out: ProfitabilityRow[];
  if (groupBy === "customer") {
    out = customerRows;
  } else if (groupBy === "order") {
    // A customer's costs are split evenly across their paid orders in the range (estimate).
    out = [];
    for (const a of byContact.values()) {
      if (a.orders.size === 0) continue;
      const c = costsOf(a);
      const n = a.orders.size;
      const split = {
        adSpendMinor: allocateEvenly(c.adSpendMinor, n),
        aiCostMinor: allocateEvenly(c.aiCostMinor, n),
        ttsCostMinor: allocateEvenly(c.ttsCostMinor, n),
        whatsappCostMinor: allocateEvenly(c.whatsappCostMinor, n),
      };
      const convs = allocateEvenly(a.conversations, n);
      [...a.orders].forEach(([orderId, rev], k) => {
        const costs: Costs = {
          adSpendMinor: split.adSpendMinor[k] ?? 0,
          aiCostMinor: split.aiCostMinor[k] ?? 0,
          ttsCostMinor: split.ttsCostMinor[k] ?? 0,
          whatsappCostMinor: split.whatsappCostMinor[k] ?? 0,
        };
        const label = `${labelOf.get(a.contactId) ?? a.contactId} · ${orderId.slice(0, 8)}`;
        out.push(row({ key: orderId, label, contactId: a.contactId, orderId, adSourceId: a.adSourceId }, rev, costs, convs[k] ?? 0, false));
      });
    }
  } else {
    out = [...ads].map(([sourceId, ad]) => {
      let revenueMinor = 0;
      let conversations = 0;
      const costs: Costs = { adSpendMinor: ad.spendMinor, aiCostMinor: 0, ttsCostMinor: 0, whatsappCostMinor: 0 };
      for (const id of ad.contacts) {
        const c = customerById.get(id);
        if (!c) continue;
        revenueMinor += c.revenueMinor;
        conversations += c.conversations;
        costs.aiCostMinor += c.aiCostMinor;
        costs.ttsCostMinor += c.ttsCostMinor;
        costs.whatsappCostMinor += c.whatsappCostMinor;
      }
      return row({ key: sourceId, label: sourceId, contactId: null, orderId: null, adSourceId: sourceId }, revenueMinor, costs, conversations, true);
    });
  }
  out.sort((x, y) => y.marginMinor - x.marginMinor || y.revenueMinor - x.revenueMinor || x.key.localeCompare(y.key));

  const sum = (k: keyof Costs | "revenueMinor" | "conversations") => customerRows.reduce((acc, r) => acc + r[k], 0);
  const totalsCosts: Costs = {
    adSpendMinor: sum("adSpendMinor"),
    aiCostMinor: sum("aiCostMinor"),
    ttsCostMinor: sum("ttsCostMinor"),
    whatsappCostMinor: sum("whatsappCostMinor"),
  };
  const revenueMinor = sum("revenueMinor");
  const conversations = sum("conversations");
  const usageCostsInMargin = currency === USAGE_COST_CURRENCY;
  const wonQuotes = rows<{ n: number }>(won)[0]?.n ?? 0;
  const byMargin = [...customerRows].sort((x, y) => y.marginMinor - x.marginMinor || x.key.localeCompare(y.key));

  const unconverted: UnconvertedContact[] = customerRows
    .filter((r) => usageOf(r) > 0 && !paidEver.has(r.key))
    .map((r) => ({ contactId: r.key, label: r.label, conversations: r.conversations, usageCostMinor: usageOf(r) }))
    .sort((x, y) => y.usageCostMinor - x.usageCostMinor || x.contactId.localeCompare(y.contactId))
    .slice(0, MAX_ROWS);

  return {
    from,
    to,
    currency,
    groupBy,
    usageCostCurrency: USAGE_COST_CURRENCY,
    usageCostsInMargin,
    currencies: [...new Set([currency, ...rows<{ currency: string }>(currencies).map((r) => r.currency)])].sort(),
    whatsappRatesSource,
    totals: {
      ...totalsCosts,
      revenueMinor,
      marginMinor: marginMinor({ currency, revenueMinor, adSpendMinor: totalsCosts.adSpendMinor, usageCostMinor: usageOf(totalsCosts) }),
      conversations,
      costPerConversationMinor: perUnit(usageOf(totalsCosts), conversations),
      wonQuotes,
      costPerWonQuoteMinor: perUnit(totalsCosts.adSpendMinor + (usageCostsInMargin ? usageOf(totalsCosts) : 0), wonQuotes),
    },
    rows: out.slice(0, MAX_ROWS),
    topCustomers: byMargin.slice(0, RANK_SIZE),
    bottomCustomers: byMargin.slice(-RANK_SIZE).reverse(),
    unconverted,
  };
}
