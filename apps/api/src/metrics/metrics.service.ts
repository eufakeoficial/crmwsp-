import type { CurrencyAmount, SalesMetrics, SalesMetricsDay, TopProduct } from "@crmwsp/contracts";
import { eq, sql, tenants, type Transaction } from "@crmwsp/db";
import { toNumReq } from "../sales/util.js";
import { conversionBp, enumerateDays, resolveRange } from "./range.js";

/** Orders that count as sales: money was verified as received and the order was not reversed. */
const SOLD = sql`('paid','fulfilled','shipped','delivered')`;
const STATUSES = ["draft", "pending_payment", "paid", "fulfilled", "shipped", "delivered", "cancelled", "refunded"] as const;
const TOP_LIMIT = 10;

type Rows<T> = T[];
const rows = <T>(r: unknown): Rows<T> => r as Rows<T>;

/** Sales funnel metrics for [from, to] (inclusive days in the tenant's time zone). Runs inside the tenant RLS transaction. */
export async function loadSalesMetrics(
  tx: Transaction,
  tenantId: string,
  query: { from?: string | undefined; to?: string | undefined },
): Promise<SalesMetrics> {
  const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  const tz = t?.tz || "UTC";
  const [today] = rows<{ d: string }>(await tx.execute(sql`select (now() at time zone ${tz})::date::text as d`));
  const { from, to } = resolveRange(query.from, query.to, today?.d ?? new Date().toISOString().slice(0, 10));

  const lo = sql`((${from}::date)::timestamp at time zone ${tz})`;
  const hi = sql`(((${to}::date + 1))::timestamp at time zone ${tz})`;
  const dayOf = (col: ReturnType<typeof sql>) => sql`((${col} at time zone ${tz})::date)::text`;

  const [convs, leads, revenue, buyersByDay, buyersTotal, statuses, top] = await Promise.all([
    tx.execute(sql`
      select ${dayOf(sql`created_at`)} as day, count(*)::int as n, count(*) filter (where ai_mode = 'auto')::int as ai
      from conversations where created_at >= ${lo} and created_at < ${hi} group by 1`),
    tx.execute(sql`
      select ${dayOf(sql`created_at`)} as day, count(*)::int as n
      from contacts where created_at >= ${lo} and created_at < ${hi} group by 1`),
    tx.execute(sql`
      select ${dayOf(sql`paid_at`)} as day, currency, sum(total_minor)::text as minor
      from orders where status in ${SOLD} and paid_at >= ${lo} and paid_at < ${hi} group by 1, 2`),
    tx.execute(sql`
      select ${dayOf(sql`paid_at`)} as day, count(distinct contact_id)::int as n
      from orders where status in ${SOLD} and paid_at >= ${lo} and paid_at < ${hi} group by 1`),
    tx.execute(sql`
      select count(distinct contact_id)::int as n
      from orders where status in ${SOLD} and paid_at >= ${lo} and paid_at < ${hi}`),
    tx.execute(sql`
      select status::text as status, count(*)::int as n
      from orders where created_at >= ${lo} and created_at < ${hi} group by 1`),
    tx.execute(sql`
      select oi.product_id::text as product_id, max(coalesce(p.name, oi.description)) as name, o.currency as currency,
             sum(oi.quantity)::int as quantity, sum(oi.line_total_minor)::text as revenue
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = oi.product_id
      where o.status in ${SOLD} and o.paid_at >= ${lo} and o.paid_at < ${hi}
      group by coalesce(oi.product_id::text, oi.description), oi.product_id, o.currency
      order by quantity desc, sum(oi.line_total_minor) desc, 2
      limit ${TOP_LIMIT}`),
  ]);

  const byDay = new Map<string, SalesMetricsDay>(
    enumerateDays(from, to).map((date) => [
      date,
      { date, newConversations: 0, newLeads: 0, buyers: 0, aiConversations: 0, humanConversations: 0, revenue: [] },
    ]),
  );
  for (const r of rows<{ day: string; n: number; ai: number }>(convs)) {
    const d = byDay.get(r.day);
    if (d) Object.assign(d, { newConversations: r.n, aiConversations: r.ai, humanConversations: r.n - r.ai });
  }
  for (const r of rows<{ day: string; n: number }>(leads)) {
    const d = byDay.get(r.day);
    if (d) d.newLeads = r.n;
  }
  for (const r of rows<{ day: string; n: number }>(buyersByDay)) {
    const d = byDay.get(r.day);
    if (d) d.buyers = r.n;
  }
  const totalRevenue = new Map<string, number>();
  for (const r of rows<{ day: string; currency: string; minor: string }>(revenue)) {
    const amountMinor = toNumReq(r.minor);
    byDay.get(r.day)?.revenue.push({ currency: r.currency, amountMinor });
    totalRevenue.set(r.currency, (totalRevenue.get(r.currency) ?? 0) + amountMinor);
  }

  const daily = [...byDay.values()];
  const sum = (k: "newConversations" | "newLeads" | "aiConversations" | "humanConversations") =>
    daily.reduce((acc, d) => acc + d[k], 0);
  const newLeads = sum("newLeads");
  const buyers = rows<{ n: number }>(buyersTotal)[0]?.n ?? 0;

  const ordersByStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<(typeof STATUSES)[number], number>;
  for (const r of rows<{ status: (typeof STATUSES)[number]; n: number }>(statuses)) ordersByStatus[r.status] = r.n;

  const topProducts: TopProduct[] = rows<{ product_id: string | null; name: string; currency: string; quantity: number; revenue: string }>(
    top,
  ).map((r) => ({ productId: r.product_id, name: r.name, currency: r.currency, quantity: r.quantity, revenueMinor: toNumReq(r.revenue) }));
  const revenueTotals: CurrencyAmount[] = [...totalRevenue].map(([currency, amountMinor]) => ({ currency, amountMinor }));

  return {
    from,
    to,
    totals: {
      newConversations: sum("newConversations"),
      newLeads,
      buyers,
      conversionBp: conversionBp(buyers, newLeads),
      aiConversations: sum("aiConversations"),
      humanConversations: sum("humanConversations"),
      revenue: revenueTotals,
      ordersByStatus,
    },
    daily,
    topProducts,
    winningProduct: topProducts[0] ?? null,
  };
}
