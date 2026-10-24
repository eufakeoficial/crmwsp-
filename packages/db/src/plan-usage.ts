import { sql } from "drizzle-orm";
import type { Transaction } from "./client.js";

export type CounterKey = "ai_messages" | "broadcast_sends";

/** Current month (`YYYY-MM`) in the current tenant's time zone (RLS-scoped `tenants` read). */
const PERIOD_SQL = sql`to_char(now() at time zone coalesce(
  (select timezone from tenants where id = nullif(current_setting('app.tenant_id', true), '')::uuid), 'UTC'), 'YYYY-MM')`;

export interface PlanUsageSnapshot {
  /** Stored plan id, `null` when the tenant has no `tenant_plans` row (default plan). */
  plan: string | null;
  /** Per-tenant limit overrides set by a platform admin (`null` = none). */
  limitsOverride: Record<string, number | null> | null;
  period: string;
  aiMessages: number;
  broadcastSends: number;
  contacts: number;
  seats: number;
  whatsappNumbers: number;
  /** Trial lifecycle (migration 0068); all null for grandfathered tenants. */
  setupEndsAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
}

const toDate = (v: string | Date | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));

/** Reads the plan and every usage figure of the current tenant (call inside `withTenant`). */
export async function readPlanUsage(tx: Transaction): Promise<PlanUsageSnapshot> {
  const [row] = await tx.execute<{
    plan: string | null;
    limits_override: Record<string, number | null> | null;
    setup_ends_at: string | Date | null;
    trial_started_at: string | Date | null;
    trial_ends_at: string | Date | null;
    period: string;
    ai_messages: string | null;
    broadcast_sends: string | null;
    contacts: string;
    seats: string;
    numbers: string;
  }>(sql`
    with p as (select ${PERIOD_SQL} as period)
    select
      (select plan from tenant_plans limit 1) as plan,
      (select limits_override from tenant_plans limit 1) as limits_override,
      (select setup_ends_at from tenant_plans limit 1) as setup_ends_at,
      (select trial_started_at from tenant_plans limit 1) as trial_started_at,
      (select trial_ends_at from tenant_plans limit 1) as trial_ends_at,
      p.period,
      (select used from usage_counters u where u.period = p.period and u.limit_key = 'ai_messages') as ai_messages,
      (select used from usage_counters u where u.period = p.period and u.limit_key = 'broadcast_sends') as broadcast_sends,
      (select count(*) from contacts) as contacts,
      (select count(*) from memberships)
        + (select count(*) from team_invitations i
           where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) as seats,
      (select count(*) from channel_connections where status <> 'disabled') as numbers
    from p`);
  if (!row) throw new Error("plan usage query returned no row");
  return {
    plan: row.plan,
    limitsOverride: row.limits_override ?? null,
    period: row.period,
    aiMessages: Number(row.ai_messages ?? 0),
    broadcastSends: Number(row.broadcast_sends ?? 0),
    contacts: Number(row.contacts),
    seats: Number(row.seats),
    whatsappNumbers: Number(row.numbers),
    setupEndsAt: toDate(row.setup_ends_at),
    trialStartedAt: toDate(row.trial_started_at),
    trialEndsAt: toDate(row.trial_ends_at),
  };
}

/**
 * Atomically adds `amount` to this month's counter only if the result stays within `limit`
 * (`null` = unlimited). Returns the new total, or `null` when the limit would be exceeded (nothing
 * is written). Safe under concurrency: the check and the increment are one upsert statement.
 */
export async function consumeUsage(
  tx: Transaction,
  tenantId: string,
  key: CounterKey,
  amount: number,
  limit: number | null,
): Promise<number | null> {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError("amount must be a non-negative integer");
  const cap = limit === null ? sql`true` : sql`usage_counters.used + excluded.used <= ${limit}`;
  const insertCap = limit === null ? sql`true` : sql`${amount} <= ${limit}`;
  const rows = await tx.execute<{ used: string }>(sql`
    insert into usage_counters (tenant_id, period, limit_key, used)
    select ${tenantId}::uuid, ${PERIOD_SQL}, ${key}, ${amount} where ${insertCap}
    on conflict (tenant_id, period, limit_key)
      do update set used = usage_counters.used + excluded.used, updated_at = now() where ${cap}
    returning used`);
  const r = rows[0];
  return r ? Number(r.used) : null;
}
