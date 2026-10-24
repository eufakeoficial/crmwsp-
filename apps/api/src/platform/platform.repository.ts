import { Inject, Injectable } from "@nestjs/common";
import type {
  LimitsOverride,
  MembershipRole,
  MonthlyPaymentTotal,
  PlatformAuditEntry,
  PlatformAuditEvent,
  PlatformChannel,
  PlatformChannelStatus,
  PlatformLimitOverride,
  PlatformPlanId,
  PlatformUser,
  PlatformTenant,
  PlatformSubscriptionCharge,
  SubscriptionPayment,
  SubscriptionPaymentListedMethod,
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

  /** Extends setup or trial (`platform_extend_lifecycle`, 0068); returns the new end. */
  async extendLifecycle(actor: string, tenantId: string, kind: "setup" | "trial", days: number, ip: string | null): Promise<Date> {
    const [r] = await this.sql<{ ends_at: Date }[]>`
      select public.platform_extend_lifecycle(${actor}, ${tenantId}, ${kind}, ${days}::integer, ${ip}::inet) as ends_at`;
    if (!r) throw new Error("platform_extend_lifecycle returned no row");
    return new Date(r.ends_at);
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

  /** NOWPayments subscription charges (all states) via `platform_list_subscription_charges` (0061). */
  async listSubscriptionCharges(actor: string, f: { tenantId?: string | undefined; status?: string | undefined }): Promise<PlatformSubscriptionCharge[]> {
    const rows = await this.sql<ChargeRow[]>`
      select charge_id, tenant_id, tenant_name, plan, price_amount, price_currency, pay_currency, pay_amount, actually_paid,
             provider_payment_id, status, provider_status, verified_by, paid_at,
             period_start::text as period_start, period_end::text as period_end, created_at
      from public.platform_list_subscription_charges(${actor}, ${f.tenantId ?? null}, ${f.status ?? null})`;
    return rows.map((r) => ({
      id: r.charge_id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      plan: r.plan,
      priceAmount: r.price_amount,
      priceCurrency: r.price_currency,
      payCurrency: r.pay_currency,
      payAmount: r.pay_amount,
      actuallyPaid: r.actually_paid,
      providerPaymentId: r.provider_payment_id,
      status: r.status,
      providerStatus: r.provider_status,
      verifiedBy: r.verified_by,
      paidAt: r.paid_at ? iso(r.paid_at) : null,
      periodStart: r.period_start,
      periodEnd: r.period_end,
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

  // --- 0057: users, channels, plans, usage, audit search ---

  async listUsers(actor: string, q: string | null, userId: string | null = null): Promise<PlatformUser[]> {
    const rows = await this.sql<
      {
        user_id: string;
        email: string;
        name: string | null;
        created_at: Date;
        last_login_at: Date | null;
        active_sessions: number;
        is_platform_admin: boolean;
        tenants: { tenantId: string; name: string; role: MembershipRole }[];
      }[]
    >`select user_id, email, name, created_at, last_login_at, active_sessions, is_platform_admin, tenants
      from public.platform_user_list(${actor}, ${q}, ${userId})`;
    return rows.map((r) => ({
      id: r.user_id,
      email: r.email,
      name: r.name,
      createdAt: iso(r.created_at),
      lastLoginAt: r.last_login_at ? iso(r.last_login_at) : null,
      activeSessions: Number(r.active_sessions),
      isPlatformAdmin: r.is_platform_admin === true,
      tenants: (r.tenants ?? []).map((t) => ({ tenantId: t.tenantId, name: t.name, role: t.role })),
    }));
  }

  async revokeUserSessions(actor: string, userId: string, ip: string | null): Promise<number> {
    const [r] = await this.sql<{ n: number }[]>`select public.platform_revoke_user_sessions(${actor}, ${userId}, ${ip}::inet) as n`;
    return Number(r?.n ?? 0);
  }

  async listChannels(actor: string, status: PlatformChannelStatus | null): Promise<PlatformChannel[]> {
    const rows = await this.sql<
      {
        channel_id: string;
        tenant_id: string;
        tenant_name: string;
        provider: string;
        phone_last4: string;
        status: PlatformChannelStatus;
        created_at: Date;
        last_inbound_at: Date | null;
        last_outbound_at: Date | null;
        failed_7d: number;
      }[]
    >`select channel_id, tenant_id, tenant_name, provider, phone_last4, status, created_at, last_inbound_at, last_outbound_at, failed_7d
      from public.platform_channel_list(${actor}, ${status})`;
    return rows.map((r) => ({
      id: r.channel_id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      provider: r.provider,
      phoneLast4: r.phone_last4,
      status: r.status,
      createdAt: iso(r.created_at),
      lastInboundAt: r.last_inbound_at ? iso(r.last_inbound_at) : null,
      lastOutboundAt: r.last_outbound_at ? iso(r.last_outbound_at) : null,
      failedLast7d: Number(r.failed_7d),
    }));
  }

  async planCounts(actor: string): Promise<{ plan: string; status: TenantStatus; count: number }[]> {
    const rows = await this.sql<{ plan: string; status: TenantStatus; tenant_count: number }[]>`
      select plan, status, tenant_count from public.platform_plan_counts(${actor})`;
    return rows.map((r) => ({ plan: r.plan, status: r.status, count: Number(r.tenant_count) }));
  }

  async limitOverrides(actor: string): Promise<PlatformLimitOverride[]> {
    const rows = await this.sql<
      { tenant_id: string; name: string; slug: string; status: TenantStatus; plan: PlatformPlanId; limits_override: LimitsOverride; updated_at: Date }[]
    >`select tenant_id, name, slug, status, plan, limits_override, updated_at from public.platform_limit_overrides(${actor})`;
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      plan: r.plan,
      limitsOverride: r.limits_override,
      updatedAt: iso(r.updated_at),
    }));
  }

  async usage(
    actor: string,
    month: string,
  ): Promise<{ tenantId: string; name: string; slug: string; plan: PlatformPlanId; aiMessages: number; broadcastSends: number; ttsCharacters: number; aiCostMicro: string }[]> {
    const rows = await this.sql<
      { tenant_id: string; name: string; slug: string; plan: PlatformPlanId; ai_messages: string; broadcast_sends: string; tts_characters: string; ai_cost_micro: string }[]
    >`select tenant_id, name, slug, plan, ai_messages, broadcast_sends, tts_characters, ai_cost_micro from public.platform_usage(${actor}, ${month})`;
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      name: r.name,
      slug: r.slug,
      plan: r.plan,
      aiMessages: Number(r.ai_messages),
      broadcastSends: Number(r.broadcast_sends),
      ttsCharacters: Number(r.tts_characters),
      aiCostMicro: String(r.ai_cost_micro),
    }));
  }

  async auditSearch(
    actor: string,
    f: { actor: string | null; action: string | null; tenantId: string | null; from: Date | null; to: Date | null; limit: number; offset: number },
  ): Promise<{ items: PlatformAuditEntry[]; total: number }> {
    const rows = await this.sql<
      {
        event_id: string;
        actor_email: string | null;
        action: string;
        tenant_id: string | null;
        tenant_name: string | null;
        diff: Record<string, unknown>;
        created_at: Date;
        total_count: string;
      }[]
    >`select event_id, actor_email, action, tenant_id, tenant_name, diff, created_at, total_count
      from public.platform_audit_search(${actor}, ${f.actor}, ${f.action}, ${f.tenantId}, ${f.from}, ${f.to}, ${f.limit}, ${f.offset})`;
    return {
      total: rows[0] ? Number(rows[0].total_count) : 0,
      items: rows.map((r) => ({
        id: r.event_id,
        actorEmail: r.actor_email,
        action: r.action,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        diff: r.diff ?? {},
        createdAt: iso(r.created_at),
      })),
    };
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
  method: SubscriptionPaymentListedMethod;
  reference: string | null;
  notes: string | null;
  recorded_by_email: string | null;
  created_at: Date;
}

interface ChargeRow {
  charge_id: string;
  tenant_id: string;
  tenant_name: string;
  plan: PlatformPlanId;
  price_amount: string;
  price_currency: string;
  pay_currency: string;
  pay_amount: string | null;
  actually_paid: string | null;
  provider_payment_id: string | null;
  status: PlatformSubscriptionCharge["status"];
  provider_status: string | null;
  verified_by: "webhook" | "reconciliation" | null;
  paid_at: Date | null;
  period_start: string | null;
  period_end: string | null;
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
