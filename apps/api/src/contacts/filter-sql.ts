import {
  ValidationError,
  filterFieldDef,
  type ContactFilter,
  type FilterCondition,
  type RelativeTime,
} from "@crmwsp/contracts";
import { adAttributions, consents, contacts, conversations, orders, quotes, sql, type SQL } from "@crmwsp/db";

/**
 * Compiles a validated `ContactFilter` into a parameterized predicate over `contacts`. Field keys
 * come from the server allowlist (`filterFieldDef`); every client value is bound as a parameter.
 * Must run inside `withTenant` so the correlated subqueries are RLS-scoped too.
 */

export const OPEN_QUOTE_STATUSES = ["draft", "pending_approval", "approved", "sent"] as const;
/** Orders whose money was confirmed (status `paid` is only set by webhook/reconciliation). */
export const PAID_ORDER_STATUSES = ["paid", "fulfilled", "shipped", "delivered"] as const;
const MAX_SEGMENT_DEPTH = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const UNIT_MS: Record<RelativeTime["unit"], number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export interface FilterCompileContext {
  /** Saved segments referenced by `segment` conditions (already loaded, tenant-scoped). */
  segments: ReadonlyMap<string, ContactFilter>;
  now: Date;
}

export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

const TRUE = sql`true`;
const FALSE = sql`false`;
const textArray = (values: readonly string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
const group = (parts: SQL[], op: SQL): SQL => sql`(${sql.join(parts.map((p) => sql`(${p})`), op)})`;
const anyOf = (parts: SQL[]): SQL => (parts.length ? group(parts, sql` or `) : FALSE);
const allOf = (parts: SQL[]): SQL => (parts.length ? group(parts, sql` and `) : TRUE);
const statusList = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

const hasOpenQuote = sql`exists (select 1 from ${quotes} where ${quotes.contactId} = ${contacts.id} and ${quotes.status}::text in (${statusList(OPEN_QUOTE_STATUSES)}))`;
const hasPaidOrder = sql`exists (select 1 from ${orders} where ${orders.contactId} = ${contacts.id} and ${orders.status}::text in (${statusList(PAID_ORDER_STATUSES)}))`;
const hasAdAttribution = sql`exists (select 1 from ${adAttributions} where ${adAttributions.contactId} = ${contacts.id})`;

function textExpr(field: string): SQL {
  switch (field) {
    case "name":
      return sql`${contacts.name}`;
    case "phone":
      return sql`${contacts.phoneE164}`;
    case "ad_id":
      return sql`(select ${adAttributions.sourceId} from ${adAttributions} where ${adAttributions.contactId} = ${contacts.id} limit 1)`;
    default:
      if (field.startsWith("cf:")) return sql`(${contacts.extracted} ->> ${field.slice(3)})`;
      throw new ValidationError(`field ${field} is not a text field`);
  }
}

function dateExpr(field: string): SQL {
  switch (field) {
    case "created_at":
      return sql`${contacts.createdAt}`;
    case "last_inbound_at":
      return sql`(select max(${conversations.lastInboundAt}) from ${conversations} where ${conversations.contactId} = ${contacts.id})`;
    case "last_message_at":
      return sql`(select max(${conversations.lastMessageAt}) from ${conversations} where ${conversations.contactId} = ${contacts.id})`;
    case "last_order_at":
      return sql`(select max(${orders.createdAt}) from ${orders} where ${orders.contactId} = ${contacts.id})`;
    default:
      throw new ValidationError(`field ${field} is not a date field`);
  }
}

function numberExpr(field: string): SQL {
  if (field === "total_paid") {
    return sql`(select coalesce(sum(${orders.totalMinor}), 0) from ${orders} where ${orders.contactId} = ${contacts.id} and ${orders.status}::text in (${statusList(PAID_ORDER_STATUSES)}))`;
  }
  throw new ValidationError(`field ${field} is not a number field`);
}

function compileText(c: FilterCondition): SQL {
  const e = textExpr(c.field);
  const v = typeof c.value === "string" ? c.value : "";
  switch (c.operator) {
    case "is":
      return sql`lower(${e}) = lower(${v})`;
    case "is_not":
      return sql`coalesce(lower(${e}), '') <> lower(${v})`;
    case "contains":
      return sql`${e} ilike ${`%${likeEscape(v)}%`}`;
    case "not_contains":
      return sql`coalesce(${e}, '') not ilike ${`%${likeEscape(v)}%`}`;
    case "starts_with":
      return sql`${e} ilike ${`${likeEscape(v)}%`}`;
    case "has_any":
      return sql`coalesce(${e}, '') <> ''`;
    case "is_unknown":
      return sql`coalesce(${e}, '') = ''`;
    default:
      throw new ValidationError(`operator ${c.operator} is not valid for text`);
  }
}

/** Date-only values are UTC days; datetimes are exact instants (`on` = same UTC day). */
function dayBounds(value: string): { start: Date; end: Date; instant: Date } {
  const instant = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(instant.getTime())) throw new ValidationError("invalid date");
  const start = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86_400_000), instant };
}

function compileDate(c: FilterCondition, now: Date): SQL {
  const e = dateExpr(c.field);
  switch (c.operator) {
    case "has_any":
      return sql`${e} is not null`;
    case "is_unknown":
      return sql`${e} is null`;
    case "less_than_ago":
    case "more_than_ago": {
      const rel = c.value as RelativeTime;
      const cutoff = new Date(now.getTime() - rel.amount * UNIT_MS[rel.unit]).toISOString();
      return c.operator === "less_than_ago" ? sql`${e} > ${cutoff}::timestamptz` : sql`${e} < ${cutoff}::timestamptz`;
    }
  }
  const raw = String(c.value);
  const b = dayBounds(raw);
  const dateOnly = raw.length === 10;
  switch (c.operator) {
    case "after":
      return sql`${e} >= ${(dateOnly ? b.end : b.instant).toISOString()}::timestamptz`;
    case "before":
      return sql`${e} < ${(dateOnly ? b.start : b.instant).toISOString()}::timestamptz`;
    case "on":
      return sql`(${e} >= ${b.start.toISOString()}::timestamptz and ${e} < ${b.end.toISOString()}::timestamptz)`;
    default:
      throw new ValidationError(`operator ${c.operator} is not valid for date`);
  }
}

function compileNumber(c: FilterCondition): SQL {
  const e = numberExpr(c.field);
  if (c.operator === "has_any") return sql`${e} > 0`;
  if (c.operator === "is_unknown") return sql`${e} = 0`;
  const v = String(Math.round(Number(c.value)));
  switch (c.operator) {
    case "eq":
      return sql`${e} = ${v}::numeric`;
    case "neq":
      return sql`${e} <> ${v}::numeric`;
    case "gt":
      return sql`${e} > ${v}::numeric`;
    case "lt":
      return sql`${e} < ${v}::numeric`;
    default:
      throw new ValidationError(`operator ${c.operator} is not valid for number`);
  }
}

function relationValue(field: string, value: string, ctx: FilterCompileContext, depth: number): SQL {
  switch (field) {
    case "marketing_consent":
      return sql`coalesce((select ${consents.status}::text from ${consents} where ${consents.contactId} = ${contacts.id} and ${consents.kind} = 'marketing'), 'none') = ${value}`;
    case "source":
      return value === "ad" ? hasAdAttribution : sql`(not ${hasAdAttribution} and ${contacts.source} = ${value})`;
    case "window_open": {
      const since = new Date(ctx.now.getTime() - WINDOW_MS).toISOString();
      const open = sql`exists (select 1 from ${conversations} where ${conversations.contactId} = ${contacts.id} and ${conversations.lastInboundAt} > ${since}::timestamptz)`;
      return value === "open" ? open : sql`not ${open}`;
    }
    case "has_open_quote":
      return value === "yes" ? hasOpenQuote : sql`not ${hasOpenQuote}`;
    case "has_paid_order":
      return value === "yes" ? hasPaidOrder : sql`not ${hasPaidOrder}`;
    case "segment": {
      const seg = ctx.segments.get(value);
      if (!seg) return FALSE;
      return compileContactFilter(seg, ctx, depth + 1) ?? TRUE;
    }
    default:
      throw new ValidationError(`field ${field} is not a relation field`);
  }
}

function compileRelation(c: FilterCondition, ctx: FilterCompileContext, depth: number): SQL {
  const values = c.value as string[];
  const positive =
    c.field === "tag" ? sql`${contacts.tags} && ${textArray(values)}` : anyOf(values.map((v) => relationValue(c.field, v, ctx, depth)));
  if (c.operator === "is") return positive;
  if (c.operator === "is_not") return sql`not ${positive}`;
  throw new ValidationError(`operator ${c.operator} is not valid for relation`);
}

export function compileCondition(c: FilterCondition, ctx: FilterCompileContext, depth = 0): SQL {
  const def = filterFieldDef(c.field);
  if (!def || def.type !== c.type) throw new ValidationError(`unknown filter field ${c.field}`);
  switch (c.type) {
    case "text":
      return compileText(c);
    case "date":
      return compileDate(c, ctx.now);
    case "number":
      return compileNumber(c);
    case "relation":
      return compileRelation(c, ctx, depth);
  }
}

/** Undefined when the filter has no conditions (matches every contact). */
export function compileContactFilter(filter: ContactFilter, ctx: FilterCompileContext, depth = 0): SQL | undefined {
  if (depth > MAX_SEGMENT_DEPTH) throw new ValidationError("segments are nested too deeply");
  if (filter.conditions.length === 0) return undefined;
  const parts = filter.conditions.map((c) => compileCondition(c, ctx, depth));
  return filter.match === "any" ? anyOf(parts) : allOf(parts);
}

/** Segment ids referenced by a filter (direct references only). */
export function referencedSegmentIds(filter: ContactFilter): string[] {
  return [...new Set(filter.conditions.filter((c) => c.field === "segment").flatMap((c) => (c.value as string[] | undefined) ?? []))];
}
