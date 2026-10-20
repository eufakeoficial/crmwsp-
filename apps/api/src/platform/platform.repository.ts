import { Inject, Injectable } from "@nestjs/common";
import type {
  LimitsOverride,
  MembershipRole,
  MonthlyPaymentTotal,
  PlatformAuditEvent,
  PlatformPlanId,
  PlatformTenant,
  SubscriptionPayment,
  SubscriptionPaymentMethod,
  TenantStatus,
  TenantStatusAction,
} from "@crmwsp/contracts";
import { DB_HANDLE, type DbHandle } from "../common/http.js";

/**
 * The ONLY data path of the platform backoffice: it calls the `platform_*` SECURITY DEFINER
 * functions of migration 0052 (the app role has no privileges on the platform tables). Every
 * function re-checks the actor against `platform_admins`.
 */
@Injectable()
export class PlatformRepository {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  private get sql() {
    return this.handle.sql;
  }

  async isAdmin(userId: string): Promise<boolean> {
    const [row] = await this.sql<{ v: boolean }[]>`select public.platform_is_admin(${userId}) as v`;
    return row?.v === true;
  }

  async listTenants(
    actor: string,
    f: { q?: string | undefined; status?: TenantStatus | undefined; plan?: PlatformPlanId | undefined; tenantId?: string },
  ): Promise<PlatformTenant[]> {
    const rows = await this.sql<TenantRow[]>`
      select tenant_id, name, slug, status, status_reason, plan, limits_override, created_at, owner_email, owner_name,
             member_count, seats, ai_messages, broadcast_sends, channel_count, last_activity_at,
             paid_until::text as paid_until, overdue, period
      from public.platform_tenant_list(${actor}, ${f.q ?? null}, ${f.status ?? null}, ${f.plan ?? null}, ${f.tenantId ?? null})`;
    return rows.map(toTenant);
  }

  async members(actor: string, tenantId: string): Promise<{ name: string | null; email: string; role: MembershipRole }[]> {
    const rows = await this.sql<{ name: string | null; email: string; role: MembershipRole }[]>`
      select name, email, role from public.platform_tenant_members(${actor}, ${tenantId})`;
    return rows.map((r) => ({ name: r.name, email: r.email, role: r.role }));
  }

  async channels(actor: string, tenantId: string): Promise<{ id: string; status: string; createdAt: string }[]> {
    const rows = await this.sql<{ channel_id: string; status: string; created_at: Date }[]>`
      select channel_id, status, created_at from public.platform_tenant_channels(${actor}, ${tenantId})`;
    return rows.map((r) => ({ id: r.channel_id, status: r.status, createdAt: iso(r.created_at) }));
  }

  async setStatus(
    actor: string,
    tenantId: string,
    action: TenantStatusAction,
    reason: string | null,
    ip: string | null,
  ): Promise<{ name: string; status: TenantStatus; previousStatus: TenantStatus; ownerEmail: string | null; ownerName: string | null }> {
    const [r] = await this.sql<
      { name: string; status: TenantStatus; previous_status: TenantStatus; owner_email: string | null; owner_name: string | null }[]
    >`select name, status, previous_status, owner_email, owner_name
      from public.platform_set_tenant_status(${actor}, ${tenantId}, ${action}, ${reason}, ${ip}::inet)`;
    if (!r) throw new Error("platform_set_tenant_status returned no row");
    return { name: r.name, status: r.status, previousStatus: r.previous_status, ownerEmail: r.owner_email, ownerName: r.owner_name };
  }

  async setPlan(actor: string, tenantId: string, plan: PlatformPlanId, limits: LimitsOverride | null, ip: string | null): Promise<void> {
    const json = limits === null ? null : JSON.stringify(limits);
    await this.sql`select public.platform_set_tenant_plan(${actor}, ${tenantId}, ${plan}, ${json}::jsonb, ${ip}::inet)`;
  }

  async recordPayment(
    actor: string,
    p: {
      tenantId: string;
      amountMinor: number;
      currency: string;
      periodStart: string;
      periodEnd: string;
      method: SubscriptionPaymentMethod;
      reference?: string | undefined;
      notes?: string | undefined;
    },
    ip: string | null,
  ): Promise<string> {
    const [r] = await this.sql<{ id: string }[]>`
      select public.platform_record_payment(${actor}, ${p.tenantId}, ${p.amountMinor}, ${p.currency},
        ${p.periodStart}::date, ${p.periodEnd}::date, ${p.method}, ${p.reference ?? null}, ${p.notes ?? null}, ${ip}::inet) as id`;
    if (!r) throw new Error("platform_record_payment returned no row");
    return r.id;
  }

  async listPayments(actor: string, f: { tenantId?: string | undefined; from?: Date; to?: Date }): Promise<SubscriptionPayment[]> {
    const rows = await this.sql<PaymentRow[]>`
      select payment_id, tenant_id, tenant_name, amount_minor, currency, period_start::text as period_start,
             period_end::text as period_end, method, reference, notes, recorded_by_email, created_at
      from public.platform_list_payments(${actor}, ${f.tenantId ?? null}, ${f.from ?? null}, ${f.to ?? null})`;
    return rows.map((r) => ({
      id: r.payment_id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      amountMinor: Number(r.amount_minor),
      currency: r.currency,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      method: r.method,
      reference: r.reference,
      notes: r.notes,
      recordedByEmail: r.recorded_by_email,
      createdAt: iso(r.created_at),
    }));
  }

  async paymentTotals(actor: string, months: number): Promise<MonthlyPaymentTotal[]> {
    const rows = await this.sql<{ month: string; currency: string; total_minor: string; payment_count: number }[]>`
      select month, currency, total_minor, payment_count from public.platform_payment_totals(${actor}, ${months})`;
    return rows.map((r) => ({ month: r.month, currency: r.currency, totalMinor: Number(r.total_minor), count: Number(r.payment_count) }));
  }

  async dashboard(actor: string): Promise<{ byStatus: Record<string, number>; activeByPlan: Record<string, number>; overdue: number }> {
    const [r] = await this.sql<{ v: { byStatus: Record<string, number>; activeByPlan: Record<string, number>; overdue: number } }[]>`
      select public.platform_dashboard(${actor}) as v`;
    if (!r) throw new Error("platform_dashboard returned no row");
    return r.v;
  }

  async audit(actor: string, tenantId: string | null, limit: number): Promise<PlatformAuditEvent[]> {
    const rows = await this.sql<
      { event_id: string; actor_email: string | null; action: string; tenant_id: string | null; diff: Record<string, unknown>; created_at: Date }[]
    >`select event_id, actor_email, action, tenant_id, diff, created_at from public.platform_audit_list(${actor}, ${tenantId}, ${limit})`;
    return rows.map((r) => ({
      id: r.event_id,
      actorEmail: r.actor_email,
      action: r.action,
      tenantId: r.tenant_id,
      diff: r.diff ?? {},
      createdAt: iso(r.created_at),
    }));
  }

  async settings(actor: string): Promise<{ requireApproval: boolean; updatedAt: string | null }> {
    const [r] = await this.sql<{ require_approval: boolean; updated_at: Date | null }[]>`
      select require_approval, updated_at from public.platform_get_settings(${actor})`;
    return { requireApproval: r?.require_approval === true, updatedAt: r?.updated_at ? iso(r.updated_at) : null };
  }

  async setRequireApproval(actor: string, value: boolean, ip: string | null): Promise<void> {
    await this.sql`select public.platform_set_require_approval(${actor}, ${value}, ${ip}::inet)`;
  }
}

interface TenantRow {
  tenant_id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  status_reason: string | null;
  plan: PlatformPlanId;
  limits_override: LimitsOverride | null;
  created_at: Date;
  owner_email: string | null;
  owner_name: string | null;
  member_count: number;
  seats: number;
  ai_messages: string;
  broadcast_sends: string;
  channel_count: number;
  last_activity_at: Date | null;
  paid_until: string | null;
  overdue: boolean;
  period: string;
}

interface PaymentRow {
  payment_id: string;
  tenant_id: string;
  tenant_name: string;
  amount_minor: string;
  currency: string;
  period_start: string;
  period_end: string;
  method: SubscriptionPaymentMethod;
  reference: string | null;
  notes: string | null;
  recorded_by_email: string | null;
  created_at: Date;
}

const iso = (d: Date | string): string => new Date(d).toISOString();

function toTenant(r: TenantRow): PlatformTenant {
  return {
    id: r.tenant_id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    statusReason: r.status_reason,
    plan: r.plan,
    limitsOverride: r.limits_override,
    createdAt: iso(r.created_at),
    ownerEmail: r.owner_email,
    ownerName: r.owner_name,
    memberCount: Number(r.member_count),
    seats: Number(r.seats),
    usagePeriod: r.period,
    aiMessages: Number(r.ai_messages),
    broadcastSends: Number(r.broadcast_sends),
    channelCount: Number(r.channel_count),
    lastActivityAt: r.last_activity_at ? iso(r.last_activity_at) : null,
    paidUntil: r.paid_until,
    overdue: r.overdue === true,
  };
}
