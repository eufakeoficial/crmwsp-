import {
  ConflictError,
  NotFoundError,
  resolveInboxSettings,
  type ListUnansweredQuotesQuery,
  type MembershipRole,
  type UnansweredQuote,
  type UnansweredQuoteListResponse,
  type UnansweredQuoteReview,
} from "@crmwsp/contracts";
import { CONFIRMED_SEND_STATUSES, QUOTE_UNANSWERED_COVERAGE_HOURS, quoteUnansweredWindow, resolveFollowUpSettings } from "@crmwsp/domain";
import { and, eq, isUuid, quoteUnansweredReviews, sql, tenants, type Transaction } from "@crmwsp/db";
import { writeAudit } from "../inbox/audit.js";
import { decodeCursor, encodeCursor } from "../inbox/cursor.js";
import { visibilityWhere } from "../inbox/inbox-v2.scope.js";

type SQL = ReturnType<typeof sql>;

export interface UnansweredQuotesCaller {
  tenantId: string;
  role: MembershipRole;
  userId: string;
}

interface Context {
  delayHours: number;
  scope: SQL | null;
}

interface CasePageRow {
  [column: string]: unknown;
  quote_id: string;
  number: string;
  currency: string;
  total_minor: string | number | bigint;
  valid_until: Date | string;
  conversation_id: string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string;
  assigned_user_id: string | null;
  assignee_name: string | null;
  message_id: string;
  sent_at: Date | string;
  eligible_us: string | number | bigint;
  reminder_at: Date | string | null;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

const hoursToMicros = (hours: number): SQL => sql.raw((BigInt(hours) * BigInt(3_600_000_000)).toString());

async function loadContext(tx: Transaction, caller: UnansweredQuotesCaller): Promise<Context> {
  const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, caller.tenantId));
  const settings: Record<string, unknown> = tenant?.settings ?? {};
  return {
    delayHours: resolveFollowUpSettings(settings["followUps"]).quoteUnanswered.delayHours,
    scope: visibilityWhere(resolveInboxSettings(settings["inbox"]), caller.role, caller.userId),
  };
}

function confirmedSend(): SQL {
  const statuses = sql.join(
    CONFIRMED_SEND_STATUSES.map((status) => sql`${status}::message_status`),
    sql`, `,
  );
  return sql`cases.message_id is not null and cases.sent_at is not null and cases.message_status in (${statuses})`;
}

function caseQuery(caller: UnansweredQuotesCaller, ctx: Context): SQL {
  const reference = sql`coalesce(m.sent_at, q.sent_at)`;
  const referenceUs = sql`(extract(epoch from ${reference}) * 1000000)::bigint`;
  const nowUs = sql`(extract(epoch from now()) * 1000000)::bigint`;
  const eligibleUs = sql`(${referenceUs} + ${hoursToMicros(ctx.delayHours)}::bigint)`;
  return sql`
    select
      q.id as quote_id,
      q.conversation_id,
      q.contact_id,
      q.number,
      q.currency,
      q.total_minor,
      q.valid_until,
      c.assigned_user_id,
      ct.name as contact_name,
      ct.phone_e164 as contact_phone,
      s.message_id,
      m.sent_at,
      m.status as message_status,
      ${eligibleUs} as eligible_us
    from quotes q
    join conversations c on c.tenant_id = q.tenant_id and c.id = q.conversation_id
    join contacts ct on ct.tenant_id = q.tenant_id and ct.id = q.contact_id
    left join quote_sends s on s.tenant_id = q.tenant_id and s.quote_id = q.id
    left join messages m on m.tenant_id = s.tenant_id and m.id = s.message_id
    where q.tenant_id = ${caller.tenantId}::uuid
      and q.status = 'sent'
      and q.valid_until > now()
      and c.status <> 'resolved'
      and ${reference} is not null
      and ${eligibleUs} <= ${nowUs}
      and ${eligibleUs} + ${hoursToMicros(QUOTE_UNANSWERED_COVERAGE_HOURS)}::bigint > ${nowUs}
      and not exists (
        select 1 from messages i
        where i.tenant_id = q.tenant_id
          and i.conversation_id = q.conversation_id
          and i.direction = 'inbound'
          and i.author = 'contact'
          and i.created_at >= coalesce(m.sent_at, q.sent_at)
      )
      and not exists (
        select 1 from quote_unanswered_reviews r
        where r.tenant_id = q.tenant_id and r.quote_id = q.id and r.message_id = s.message_id
      )
      ${ctx.scope ? sql`and ${ctx.scope}` : sql``}`;
}

function pageQuery(caller: UnansweredQuotesCaller, cases: SQL, cursor: string | undefined, limit: number): SQL {
  let after: SQL = sql``;
  if (cursor) {
    const cur = decodeCursor(cursor);
    after = sql`and (cases.eligible_us, cases.quote_id) > (${cur.t}::bigint, ${cur.id}::uuid)`;
  }
  return sql`
    with cases as (${cases})
    select cases.*,
      coalesce(nullif(u.name, ''), u.email) as assignee_name,
      (
        select min(fu.scheduled_at) from follow_ups fu
        where fu.tenant_id = ${caller.tenantId}::uuid and fu.quote_id = cases.quote_id and fu.status = 'scheduled'
      ) as reminder_at
    from cases
    left join users u on u.id = cases.assigned_user_id
    where ${confirmedSend()} ${after}
    order by cases.eligible_us, cases.quote_id
    limit ${limit}::int`;
}

function countsQuery(cases: SQL): SQL {
  return sql`
    with cases as (${cases})
    select
      count(*) filter (where ${confirmedSend()})::int as eligible,
      count(*) filter (where cases.message_id is null)::int as unknown_coverage
    from cases`;
}

function toDto(r: CasePageRow, delayHours: number): UnansweredQuote {
  const sentAt = toDate(r.sent_at);
  return {
    quoteId: r.quote_id,
    number: r.number,
    conversationId: r.conversation_id,
    contactId: r.contact_id,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    totalMinor: Number(r.total_minor),
    currency: r.currency,
    sentAt: sentAt.toISOString(),
    eligibleAt: quoteUnansweredWindow(sentAt, delayHours).eligibleAt.toISOString(),
    validUntil: toDate(r.valid_until).toISOString(),
    assignee: r.assigned_user_id ? { id: r.assigned_user_id, name: r.assignee_name ?? r.assigned_user_id } : null,
    reminderAt: r.reminder_at ? toDate(r.reminder_at).toISOString() : null,
  };
}

export async function listUnansweredQuotes(
  tx: Transaction,
  caller: UnansweredQuotesCaller,
  q: ListUnansweredQuotesQuery,
): Promise<UnansweredQuoteListResponse> {
  const ctx = await loadContext(tx, caller);
  const cases = caseQuery(caller, ctx);
  const rows = await tx.execute<CasePageRow>(pageQuery(caller, cases, q.cursor, q.limit + 1));
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const [totals] = await tx.execute<{ eligible: number; unknown_coverage: number }>(countsQuery(cases));
  return {
    items: page.map((r) => toDto(r, ctx.delayHours)),
    nextCursor: rows.length > q.limit && last ? encodeCursor({ t: String(last.eligible_us), id: last.quote_id }) : null,
    counts: { eligible: Number(totals?.eligible ?? 0), unknownCoverage: Number(totals?.unknown_coverage ?? 0) },
  };
}

export async function countUnansweredQuotes(tx: Transaction, caller: UnansweredQuotesCaller): Promise<number> {
  const [totals] = await tx.execute<{ eligible: number }>(countsQuery(caseQuery(caller, await loadContext(tx, caller))));
  return Number(totals?.eligible ?? 0);
}

async function findReview(tx: Transaction, tenantId: string, quoteId: string): Promise<UnansweredQuoteReview | null> {
  const [row] = await tx
    .select({ quoteId: quoteUnansweredReviews.quoteId, messageId: quoteUnansweredReviews.messageId, reviewedBy: quoteUnansweredReviews.reviewedBy, reviewedAt: quoteUnansweredReviews.reviewedAt })
    .from(quoteUnansweredReviews)
    .where(and(eq(quoteUnansweredReviews.tenantId, tenantId), eq(quoteUnansweredReviews.quoteId, quoteId)))
    .orderBy(quoteUnansweredReviews.reviewedAt)
    .limit(1);
  return row ? { quoteId: row.quoteId, messageId: row.messageId, reviewedBy: row.reviewedBy, reviewedAt: row.reviewedAt.toISOString() } : null;
}

export async function reviewUnansweredQuote(
  tx: Transaction,
  caller: UnansweredQuotesCaller,
  quoteId: string,
  ip: string | undefined,
): Promise<UnansweredQuoteReview> {
  if (!isUuid(quoteId)) throw new NotFoundError();
  const ctx = await loadContext(tx, caller);
  const visible = await tx.execute<{ id: string }>(sql`
    select q.id
    from quotes q
    join conversations c on c.tenant_id = q.tenant_id and c.id = q.conversation_id
    where q.id = ${quoteId}::uuid ${ctx.scope ? sql`and ${ctx.scope}` : sql``}`);
  if (visible.length === 0) throw new NotFoundError();
  const pending = await tx.execute<{ message_id: string }>(sql`
    with cases as (${caseQuery(caller, ctx)})
    select cases.message_id from cases where cases.quote_id = ${quoteId}::uuid and ${confirmedSend()}`);
  if (pending.length === 0) {
    const existing = await findReview(tx, caller.tenantId, quoteId);
    if (existing) return existing;
    throw new ConflictError("The quote is no longer waiting for an answer", { details: { reason: "quote_not_unanswered" } });
  }
  const messageId = pending[0]!.message_id;
  const inserted = await tx
    .insert(quoteUnansweredReviews)
    .values({ tenantId: caller.tenantId, quoteId, messageId, reviewedBy: caller.userId })
    .onConflictDoNothing({ target: [quoteUnansweredReviews.tenantId, quoteUnansweredReviews.quoteId, quoteUnansweredReviews.messageId] })
    .returning({ id: quoteUnansweredReviews.id });
  if (inserted.length > 0) {
    await writeAudit(tx, { tenantId: caller.tenantId, userId: caller.userId, entity: "quote", entityId: quoteId, action: "quote.unanswered_reviewed", diff: { messageId }, ip });
  }
  const review = await findReview(tx, caller.tenantId, quoteId);
  if (!review) throw new Error("quote review was not stored");
  return review;
}
