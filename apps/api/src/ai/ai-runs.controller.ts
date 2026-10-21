import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  aiHandoffsQuerySchema,
  aiRunsQuerySchema,
  aiRunsSummaryQuerySchema,
  type AiHandoffList,
  type AiRunCitation,
  type AiRunList,
  type AiRunOutcome,
  type AiRunsSummary,
  type PlaybookSummaryRow,
} from "@crmwsp/contracts";
import { eq, inArray, isUuid, knowledgeChunks, knowledgeSources, sql, type Transaction } from "@crmwsp/db";
import {
  AI_BLOCKED_REASONS,
  AI_ERROR_REASONS,
  AI_ERROR_REASON_PREFIX,
  AI_RUN_ACTION_TYPES,
  classifyAiRun,
  isSalesStage,
} from "@crmwsp/domain";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { RequestTenant } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { decodeCursor, encodeCursor } from "../inbox/cursor.js";
import type { SQL } from "../inbox/inbox.queries.js";
import { loadInboxSettings, visibilityWhere } from "../inbox/inbox-v2.scope.js";

/** `payments.verified_by` values that prove a charge (ADR 0012: manual is an audited human decision). */
const PAID_VERIFIED_BY = ["webhook", "reconciliation", "manual"] as const;

interface SummaryRow extends Record<string, unknown> {
  key: string;
  runs: number;
  conversations: number;
  quote_accepted: number;
  paid_verified: number;
}

const EXCERPT_CHARS = 240;
const TEXT_PREVIEW_CHARS = 600;

const isoOf = (v: Date | string): string => new Date(v).toISOString();
const list = (values: readonly string[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** SQL predicate per outcome; mirrors `classifyAiRun` in @crmwsp/domain. `a` = ai_actions. */
function outcomeWhere(outcome: AiRunOutcome): SQL {
  const reason = sql`coalesce(a.decision_reason, '')`;
  const blocked = sql`${reason} in (${list(AI_BLOCKED_REASONS)})`;
  const error = sql`(${reason} in (${list(AI_ERROR_REASONS)}) or left(${reason}, ${AI_ERROR_REASON_PREFIX.length}) = ${AI_ERROR_REASON_PREFIX})`;
  switch (outcome) {
    case "sent":
      return sql`a.type = 'send_reply'`;
    case "draft":
      return sql`a.type = 'draft_reply'`;
    case "blocked":
      return sql`(a.type = 'handoff' and ${blocked})`;
    case "error":
      return sql`(a.type = 'handoff' and ${error})`;
    case "handoff":
      return sql`(a.type = 'handoff' and not ${blocked} and not ${error})`;
  }
}

const CREATED_US = sql`(extract(epoch from a.created_at) * 1000000)::bigint`;

interface RunRow extends Record<string, unknown> {
  id: string;
  type: string;
  created_at: Date | string;
  conversation_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  reason: string | null;
  model: string | null;
  confidence: string | null;
  text: string | null;
  citations: Array<{ chunkId: string; sourceId?: string }> | null;
  sales_stage: string | null;
  objection: string | null;
  sort_us: string;
}

interface HandoffRow extends Record<string, unknown> {
  id: string;
  conversation_id: string;
  contact_name: string | null;
  contact_phone: string;
  reason: string | null;
  handed_off_at: Date | string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  sort_us: string;
}

/** Title/excerpt are filled from the cited chunk while it still exists (RLS-scoped). */
async function chunkInfo(tx: Transaction, rows: RunRow[]): Promise<Map<string, { title: string; excerpt: string }>> {
  const ids = [...new Set(rows.flatMap((r) => (r.citations ?? []).map((c) => c.chunkId)))].filter(isUuid);
  const out = new Map<string, { title: string; excerpt: string }>();
  if (ids.length === 0) return out;
  const found = await tx
    .select({ id: knowledgeChunks.id, content: knowledgeChunks.content, title: knowledgeSources.title })
    .from(knowledgeChunks)
    .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeChunks.sourceId))
    .where(inArray(knowledgeChunks.id, ids));
  for (const r of found) out.set(r.id, { title: r.title, excerpt: r.content.slice(0, EXCERPT_CHARS) });
  return out;
}

/** Read models for the AI section of the panel: what the AI did and what needs a human. */
@Controller("ai")
@UseGuards(TenantGuard)
export class AiRunsController {
  @Get("runs")
  @Roles("owner", "admin", "agent")
  async runs(@CurrentTenantDb() db: TenantDb, @CurrentTenant() tenant: RequestTenant, @Query() query: unknown): Promise<AiRunList> {
    const q = parseOrThrow(aiRunsQuerySchema, query);
    return db.run(async (tx) => {
      const where: SQL[] = [sql`a.type in (${list(AI_RUN_ACTION_TYPES)})`];
      const scope = visibilityWhere(await loadInboxSettings(tx, db.tenantId), tenant.role, db.userId);
      if (scope) where.push(scope);
      if (q.outcome) where.push(outcomeWhere(q.outcome));
      if (q.mode) where.push(q.mode === "auto" ? sql`a.type = 'send_reply'` : sql`a.type = 'draft_reply'`);
      if (q.conversationId) where.push(sql`a.conversation_id = ${q.conversationId}::uuid`);
      if (q.cursor) {
        const cur = decodeCursor(q.cursor);
        where.push(sql`(${CREATED_US}, a.id) < (${cur.t}::bigint, ${cur.id}::uuid)`);
      }
      const rows = await tx.execute<RunRow>(sql`
        select a.id, a.type, a.created_at, a.conversation_id, ct.name as contact_name, ct.phone_e164 as contact_phone,
               a.decision_reason as reason, a.model, a.confidence::text as confidence,
               left(a.payload->>'text', ${TEXT_PREVIEW_CHARS}) as text, a.citations,
               a.payload->>'salesStage' as sales_stage, a.payload->>'objection' as objection,
               ${CREATED_US}::text as sort_us
        from ai_actions a
        left join conversations c on c.id = a.conversation_id
        left join contacts ct on ct.id = c.contact_id
        where ${sql.join(where, sql` and `)}
        order by ${CREATED_US} desc, a.id desc
        limit ${q.limit + 1}
      `);
      const page = rows.slice(0, q.limit);
      const chunks = await chunkInfo(tx, page);
      const last = page[page.length - 1];
      return {
        items: page.flatMap((r) => {
          const kind = classifyAiRun(r.type, r.reason);
          if (!kind) return [];
          const citations: AiRunCitation[] = (r.citations ?? []).map((c) => ({
            chunkId: c.chunkId,
            ...(c.sourceId ? { sourceId: c.sourceId } : {}),
            ...(chunks.get(c.chunkId) ?? {}),
          }));
          return [
            {
              id: r.id,
              createdAt: isoOf(r.created_at),
              conversationId: r.conversation_id,
              contactName: r.contact_name ?? r.contact_phone,
              mode: kind.mode,
              outcome: kind.outcome,
              reason: r.reason,
              model: r.model,
              confidence: r.confidence === null ? null : Number(r.confidence),
              text: r.text,
              citations,
              salesStage: isSalesStage(r.sales_stage) ? r.sales_stage : null,
              objection: r.objection,
            },
          ];
        }),
        nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.sort_us, id: last.id }) : null,
      };
    });
  }

  /**
   * Read-only outcome attribution of the sales playbook: per detected stage / objection, how many AI
   * replies carried it and how many of those conversations LATER got a quote accepted or an order paid.
   * "Paid" counts only a succeeded payment verified by `webhook`, `reconciliation` or the audited
   * `manual` mark (ADR 0012); a receipt image never counts. Nothing here changes any prompt.
   */
  @Get("runs/summary")
  @Roles("owner", "admin")
  async summary(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<AiRunsSummary> {
    const q = parseOrThrow(aiRunsSummaryQuerySchema, query);
    return db.run(async (tx) => {
      const group = async (dim: "stage" | "objection"): Promise<PlaybookSummaryRow[]> => {
        const key = dim === "stage" ? sql`a.payload->>'salesStage'` : sql`a.payload->>'objection'`;
        const rows = await tx.execute<SummaryRow>(sql`
          with runs as (
            select a.tenant_id, a.conversation_id, a.created_at, ${key} as k
            from ai_actions a
            where a.type in ('send_reply', 'draft_reply')
              and a.conversation_id is not null
              and ${key} is not null
              and a.created_at >= now() - make_interval(days => ${q.days}::int)
          ), flagged as (
            select r.*,
              exists (select 1 from quotes qt where qt.tenant_id = r.tenant_id and qt.conversation_id = r.conversation_id
                      and qt.status = 'accepted' and qt.accepted_at >= r.created_at) as quote_accepted,
              exists (select 1 from orders o join payments p on p.tenant_id = o.tenant_id and p.order_id = o.id
                      where o.tenant_id = r.tenant_id and o.conversation_id = r.conversation_id
                      and p.status = 'succeeded' and p.verified_by in (${list(PAID_VERIFIED_BY)}) and p.paid_at >= r.created_at) as paid_verified
            from runs r
          )
          select k as key, count(*)::int as runs, count(distinct conversation_id)::int as conversations,
                 count(distinct conversation_id) filter (where quote_accepted)::int as quote_accepted,
                 count(distinct conversation_id) filter (where paid_verified)::int as paid_verified
          from flagged group by k order by runs desc, k asc
        `);
        return rows.map((r) => ({
          key: r.key,
          runs: r.runs,
          conversations: r.conversations,
          quoteAccepted: r.quote_accepted,
          paidVerified: r.paid_verified,
        }));
      };
      return { days: q.days, byStage: await group("stage"), byObjection: await group("objection") };
    });
  }

  /**
   * Conversations the AI handed to a human that nobody has answered yet: open in the inbox,
   * not resolved, and no human message after the latest handoff. Longest wait first.
   */
  @Get("handoffs")
  @Roles("owner", "admin", "agent")
  async handoffs(@CurrentTenantDb() db: TenantDb, @CurrentTenant() tenant: RequestTenant, @Query() query: unknown): Promise<AiHandoffList> {
    const q = parseOrThrow(aiHandoffsQuerySchema, query);
    return db.run(async (tx) => {
      const where: SQL[] = [
        sql`c.inbox_status = 'open'`,
        sql`c.status <> 'resolved'`,
        sql`not exists (select 1 from messages m where m.tenant_id = c.tenant_id and m.conversation_id = c.id
              and m.direction = 'outbound' and m.author = 'user' and m.created_at > h.created_at)`,
      ];
      const scope = visibilityWhere(await loadInboxSettings(tx, db.tenantId), tenant.role, db.userId);
      if (scope) where.push(scope);
      if (q.assignedTo === "me") where.push(sql`c.assigned_user_id = ${db.userId}::uuid`);
      else if (q.assignedTo === "unassigned") where.push(sql`c.assigned_user_id is null`);
      if (q.cursor) {
        const cur = decodeCursor(q.cursor);
        where.push(sql`((extract(epoch from h.created_at) * 1000000)::bigint, c.id) > (${cur.t}::bigint, ${cur.id}::uuid)`);
      }
      const rows = await tx.execute<HandoffRow>(sql`
        select h.id, c.id as conversation_id, ct.name as contact_name, ct.phone_e164 as contact_phone,
               h.decision_reason as reason, h.created_at as handed_off_at,
               u.id as assignee_id, u.name as assignee_name, u.email as assignee_email,
               (extract(epoch from h.created_at) * 1000000)::bigint::text as sort_us
        from conversations c
        join contacts ct on ct.id = c.contact_id
        join lateral (
          select a.id, a.decision_reason, a.created_at from ai_actions a
          where a.tenant_id = c.tenant_id and a.conversation_id = c.id and a.type = 'handoff'
          order by a.created_at desc, a.id desc limit 1
        ) h on true
        left join users u on u.id = c.assigned_user_id
        where ${sql.join(where, sql` and `)}
        order by h.created_at asc, c.id asc
        limit ${q.limit + 1}
      `);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          id: r.id,
          conversationId: r.conversation_id,
          contactName: r.contact_name,
          contactPhone: r.contact_phone,
          reason: r.reason,
          handedOffAt: isoOf(r.handed_off_at),
          assigneeId: r.assignee_id,
          assigneeName: r.assignee_name ?? r.assignee_email,
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.sort_us, id: last.conversation_id }) : null,
      };
    });
  }
}
