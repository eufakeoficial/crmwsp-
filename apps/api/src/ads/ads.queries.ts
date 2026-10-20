import type { AdReportRow } from "@crmwsp/contracts";
import { computeRoas } from "@crmwsp/domain";
import { sql, type Transaction } from "@crmwsp/db";

interface AggRow extends Record<string, unknown> {
  source_id: string;
  headline: string | null;
  source_url: string | null;
  conversations: number | string;
  orders: number | string;
  paid_orders: number | string;
}
interface MoneyRow extends Record<string, unknown> {
  source_id: string;
  currency: string;
  amount_minor: string | number;
}

const UNKNOWN = "unknown";
const toNum = (v: number | string | null | undefined) => Number(v ?? 0);

/**
 * ROAS-style report per ad id (first-touch attribution). Orders are attributed through the
 * contact. Revenue counts ONLY orders backed by a succeeded payment with
 * verified_by IN ('webhook', 'reconciliation'); manually marked orders count as orders, never as
 * paid revenue. Runs inside withTenant: RLS scopes every table.
 */
export async function adReport(tx: Transaction): Promise<AdReportRow[]> {
  const agg = await tx.execute<AggRow>(sql`
    select coalesce(a.source_id, ${UNKNOWN}) as source_id,
           max(a.headline) as headline,
           max(a.source_url) as source_url,
           count(distinct a.conversation_id) as conversations,
           count(distinct o.id) filter (where o.status not in ('draft', 'cancelled')) as orders,
           count(distinct o.id) filter (where vp.order_id is not null) as paid_orders
    from ad_attributions a
    left join orders o on o.tenant_id = a.tenant_id and o.contact_id = a.contact_id
    left join (
      select distinct p.order_id from payments p
      where p.status = 'succeeded' and p.verified_by in ('webhook', 'reconciliation')
    ) vp on vp.order_id = o.id
    group by 1`);
  const revenue = await tx.execute<MoneyRow>(sql`
    select coalesce(a.source_id, ${UNKNOWN}) as source_id, o.currency, sum(o.total_minor)::text as amount_minor
    from ad_attributions a
    join orders o on o.tenant_id = a.tenant_id and o.contact_id = a.contact_id
    where o.status in ('paid', 'fulfilled', 'shipped', 'delivered')
      and exists (
        select 1 from payments p
        where p.order_id = o.id and p.status = 'succeeded' and p.verified_by in ('webhook', 'reconciliation'))
    group by 1, 2`);
  const spend = await tx.execute<MoneyRow & { label: string | null }>(sql`
    select source_id, currency, amount_minor::text as amount_minor, label from ad_spend`);

  const ids = new Set<string>([...agg.map((r) => r.source_id), ...spend.map((r) => r.source_id)]);
  const money = (rows: MoneyRow[], id: string) =>
    rows.filter((r) => r.source_id === id).map((r) => ({ currency: r.currency.trim(), amountMinor: toNum(r.amount_minor) }));
  return [...ids]
    .map((id): AdReportRow => {
      const a = agg.find((r) => r.source_id === id);
      return {
        sourceId: id,
        label: spend.find((s) => s.source_id === id && s.label)?.label ?? null,
        headline: a?.headline ?? null,
        sourceUrl: a?.source_url ?? null,
        conversations: toNum(a?.conversations),
        orders: toNum(a?.orders),
        paidOrders: toNum(a?.paid_orders),
        byCurrency: computeRoas(money(revenue, id), money(spend, id)),
      };
    })
    .sort((x, y) => y.conversations - x.conversations || x.sourceId.localeCompare(y.sourceId));
}
