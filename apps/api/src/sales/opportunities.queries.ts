import {
  NotFoundError,
  type Opportunity,
  type Pipeline,
  type QuoteStatus,
} from "@crmwsp/contracts";
import {
  and,
  asc,
  contacts,
  desc,
  eq,
  inArray,
  opportunities,
  pipelineStages,
  pipelines,
  quotes,
  sql,
  users,
  type Transaction,
} from "@crmwsp/db";
import { iso, toNum, toNumReq } from "./util.js";

type SQL = ReturnType<typeof sql>;

export const OPP_US = sql`(extract(epoch from ${opportunities.updatedAt}) * 1000000)::bigint`;

/** Seeds the default pipeline for tenants created before migration 0015 (idempotent). */
export async function ensureDefaultPipeline(tx: Transaction, tenantId: string): Promise<void> {
  const [any] = await tx.select({ id: pipelines.id }).from(pipelines).limit(1);
  if (!any) await tx.execute(sql`select public.seed_default_pipeline(${tenantId}::uuid)`);
}

export async function listPipelines(tx: Transaction): Promise<Pipeline[]> {
  const ps = await tx.select().from(pipelines).orderBy(desc(pipelines.isDefault), asc(pipelines.createdAt), asc(pipelines.id));
  if (ps.length === 0) return [];
  const stages = await tx
    .select()
    .from(pipelineStages)
    .where(inArray(pipelineStages.pipelineId, ps.map((p) => p.id)))
    .orderBy(asc(pipelineStages.position));
  return ps.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: stages
      .filter((s) => s.pipelineId === p.id)
      .map((s) => ({ id: s.id, key: s.key, name: s.name, position: s.position, kind: s.kind })),
  }));
}

export interface OpportunityPage {
  items: Opportunity[];
  /** Sort keys aligned with `items`, for the keyset cursor. */
  sortUs: string[];
}

/** Opportunities (newest update first) with contact, owner and latest quote. */
export async function selectOpportunities(tx: Transaction, where: Array<SQL | undefined>, limit: number): Promise<OpportunityPage> {
  const rows = await tx
    .select({
      o: opportunities,
      contactName: contacts.name,
      contactPhone: contacts.phoneE164,
      ownerName: users.name,
      ownerEmail: users.email,
      sortUs: sql<string>`${OPP_US}::text`,
    })
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .leftJoin(users, eq(users.id, opportunities.ownerUserId))
    .where(and(...where))
    .orderBy(desc(OPP_US), desc(opportunities.id))
    .limit(limit);
  const ids = rows.map((r) => r.o.id);
  const lastQuote = new Map<string, Opportunity["lastQuote"]>();
  if (ids.length > 0) {
    const qs = await tx
      .select({ id: quotes.id, number: quotes.number, status: quotes.status, total: quotes.totalMinor, opp: quotes.opportunityId })
      .from(quotes)
      .where(inArray(quotes.opportunityId, ids))
      .orderBy(desc(quotes.createdAt), desc(quotes.id));
    for (const q of qs) {
      if (q.opp && !lastQuote.has(q.opp)) {
        lastQuote.set(q.opp, { id: q.id, number: q.number, status: q.status as QuoteStatus, totalMinor: toNumReq(q.total) });
      }
    }
  }
  return {
    sortUs: rows.map((r) => r.sortUs),
    items: rows.map((r) => ({
      id: r.o.id,
      title: r.o.title,
      contact: { id: r.o.contactId, name: r.contactName, phoneE164: r.contactPhone },
      pipelineId: r.o.pipelineId,
      stageId: r.o.stageId,
      valueMinor: toNum(r.o.valueMinor),
      currency: r.o.currency,
      owner: r.o.ownerUserId ? { id: r.o.ownerUserId, name: r.ownerName ?? r.ownerEmail ?? "" } : null,
      nextActionAt: iso(r.o.nextActionAt),
      lostReason: r.o.lostReason,
      wonAt: iso(r.o.wonAt),
      lostAt: iso(r.o.lostAt),
      lastQuote: lastQuote.get(r.o.id) ?? null,
      updatedAt: r.o.updatedAt.toISOString(),
      lockVersion: r.o.lockVersion,
    })),
  };
}

export async function loadOpportunity(tx: Transaction, id: string): Promise<Opportunity> {
  const page = await selectOpportunities(tx, [eq(opportunities.id, id)], 1);
  const [o] = page.items;
  if (!o) throw new NotFoundError();
  return o;
}
