import { Inject, Injectable, Logger } from "@nestjs/common";
import { PLAN_IDS, getPlan, isPlanId } from "@crmwsp/billing";
import {
  ConflictError,
  NotFoundError,
  type PlatformAuditPage,
  type PlatformAuditQuery,
  type PlatformChannel,
  type PlatformChannelListQuery,
  type PlatformPlans,
  type PlatformSubscriptionChargeList,
  type PlatformSubscriptionChargeQuery,
  type PlatformUsage,
  type PlatformUsageQuery,
  type PlatformUser,
  type PlatformUserListQuery,
  type RevokeSessionsResponse,
  type TenantStatus,
  type PlatformDashboard,
  type PlatformSettings,
  type PlatformTenant,
  type PlatformTenantDetail,
  type PlatformTenantListQuery,
  type RecordSubscriptionPaymentRequest,
  type SubscriptionPayment,
  type SubscriptionPaymentList,
  type SubscriptionPaymentListQuery,
  type TenantPlanChangeRequest,
  type TenantLifecycleExtendRequest,
  type TenantTrialGrantResponse,
  MULTIACCOUNT_THRESHOLD,
  type TenantLifecycleExtendResponse,
  type TenantStatusChangeRequest,
  ValidationError,
} from "@crmwsp/contracts";
import { currentMonthUtc, dayRangeUtc, estimateMrr, microCentsToUsd } from "@crmwsp/domain";
import { type Mailer, emailContextFromEnv, siteLink, templateMessage } from "@crmwsp/mailer";
import { pgCode } from "../inbox/audit.js";
import { PlatformRepository } from "./platform.repository.js";

/** Nest injection token for the mailer used by the platform module. */
export const PLATFORM_MAILER = Symbol("PLATFORM_MAILER");

const AUDIT_PAGE_SIZE = 50;

export interface PlatformActor {
  userId: string;
  ip: string | null;
}

/** Maps the definer functions' SQLSTATEs (no data in them) to API errors. */
function mapDbError(err: unknown): never {
  switch (pgCode(err)) {
    case "42501":
    case "P0002":
      throw new NotFoundError();
    case "22023":
      throw new ValidationError("Invalid argument");
    case "55000":
      throw new ConflictError("Transition not allowed for the current status");
    default:
      throw err;
  }
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    mapDbError(err);
  }
}

const monthRange = (month: string): { from: Date; to: Date } => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
};

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    @Inject(PlatformRepository) private readonly repo: PlatformRepository,
    @Inject(PLATFORM_MAILER) private readonly mailer: Mailer,
  ) {}

  isAdmin(userId: string): Promise<boolean> {
    return this.repo.isAdmin(userId);
  }

  async listTenants(actor: PlatformActor, q: PlatformTenantListQuery): Promise<PlatformTenant[]> {
    const [rows, suspects] = await guarded(() =>
      Promise.all([this.repo.listTenants(actor.userId, q), this.repo.multiAccountSuspects(actor.userId, MULTIACCOUNT_THRESHOLD)]),
    );
    return rows.map((t) => ({ ...t, multiAccountSuspect: suspects.has(t.id) }));
  }

  async grantTrial(actor: PlatformActor, tenantId: string): Promise<TenantTrialGrantResponse> {
    const endsAt = await guarded(() => this.repo.grantTrial(actor.userId, tenantId, actor.ip));
    return { trialEndsAt: endsAt.toISOString() };
  }

  async tenantDetail(actor: PlatformActor, tenantId: string): Promise<PlatformTenantDetail> {
    return guarded(async () => {
      const [found] = await this.repo.listTenants(actor.userId, { tenantId });
      if (!found) throw new NotFoundError();
      const suspects = await this.repo.multiAccountSuspects(actor.userId, MULTIACCOUNT_THRESHOLD);
      const tenant = { ...found, multiAccountSuspect: suspects.has(found.id) };
      const [members, channels, payments, audit] = await Promise.all([
        this.repo.members(actor.userId, tenantId),
        this.repo.channels(actor.userId, tenantId),
        this.repo.listPayments(actor.userId, { tenantId }),
        this.repo.audit(actor.userId, tenantId, 50),
      ]);
      return { tenant, members, channels, payments, audit };
    });
  }

  async changeStatus(actor: PlatformActor, tenantId: string, body: TenantStatusChangeRequest): Promise<PlatformTenant> {
    const reason = body.reason && body.reason.length > 0 ? body.reason : null;
    const res = await guarded(() => this.repo.setStatus(actor.userId, tenantId, body.action, reason, actor.ip));
    if (res.ownerEmail && body.action !== "reactivate") await this.notifyOwner(res.ownerEmail, res.ownerName, res.name, body.action, reason);
    const [tenant] = await guarded(() => this.repo.listTenants(actor.userId, { tenantId }));
    if (!tenant) throw new NotFoundError();
    return tenant;
  }

  async changePlan(actor: PlatformActor, tenantId: string, body: TenantPlanChangeRequest): Promise<PlatformTenant> {
    const limits = body.limitsOverride && Object.keys(body.limitsOverride).length > 0 ? body.limitsOverride : null;
    await guarded(() => this.repo.setPlan(actor.userId, tenantId, body.plan, limits, actor.ip));
    const [tenant] = await guarded(() => this.repo.listTenants(actor.userId, { tenantId }));
    if (!tenant) throw new NotFoundError();
    return tenant;
  }

  async extendLifecycle(actor: PlatformActor, tenantId: string, body: TenantLifecycleExtendRequest): Promise<TenantLifecycleExtendResponse> {
    const endsAt = await guarded(() => this.repo.extendLifecycle(actor.userId, tenantId, body.kind, body.days, actor.ip));
    return { kind: body.kind, endsAt: endsAt.toISOString() };
  }

  async recordPayment(actor: PlatformActor, body: RecordSubscriptionPaymentRequest): Promise<SubscriptionPayment> {
    const id = await guarded(() => this.repo.recordPayment(actor.userId, body, actor.ip));
    const rows = await guarded(() => this.repo.listPayments(actor.userId, { tenantId: body.tenantId }));
    const row = rows.find((p) => p.id === id);
    if (!row) throw new NotFoundError();
    return row;
  }

  async listPayments(actor: PlatformActor, q: SubscriptionPaymentListQuery): Promise<SubscriptionPaymentList> {
    return guarded(async () => {
      const range = q.month ? monthRange(q.month) : {};
      const [items, totals] = await Promise.all([
        this.repo.listPayments(actor.userId, { tenantId: q.tenantId, ...range }),
        this.repo.paymentTotals(actor.userId, 12),
      ]);
      return { items, totals };
    });
  }

  async dashboard(actor: PlatformActor): Promise<PlatformDashboard> {
    return guarded(async () => {
      const [d, totals] = await Promise.all([this.repo.dashboard(actor.userId), this.repo.paymentTotals(actor.userId, 1)]);
      const month = new Date().toISOString().slice(0, 7);
      return {
        byStatus: d.byStatus,
        activeByPlan: d.activeByPlan,
        mrrEstimateUsd: estimateMrr(d.activeByPlan, (p) => (isPlanId(p) ? getPlan(p).priceMonthlyUsd : undefined)),
        paymentsThisMonth: totals.filter((t) => t.month === month),
        overdue: d.overdue,
      };
    });
  }

  settings(actor: PlatformActor): Promise<PlatformSettings> {
    return guarded(() => this.repo.settings(actor.userId));
  }

  async updateSettings(actor: PlatformActor, requireApproval: boolean): Promise<PlatformSettings> {
    await guarded(() => this.repo.setRequireApproval(actor.userId, requireApproval, actor.ip));
    return this.settings(actor);
  }

  listUsers(actor: PlatformActor, q: PlatformUserListQuery): Promise<PlatformUser[]> {
    return guarded(() => this.repo.listUsers(actor.userId, q.q && q.q.length > 0 ? q.q : null));
  }

  async user(actor: PlatformActor, userId: string): Promise<PlatformUser> {
    const [u] = await guarded(() => this.repo.listUsers(actor.userId, null, userId));
    if (!u) throw new NotFoundError();
    return u;
  }

  async revokeSessions(actor: PlatformActor, userId: string): Promise<RevokeSessionsResponse> {
    return { revoked: await guarded(() => this.repo.revokeUserSessions(actor.userId, userId, actor.ip)) };
  }

  listChannels(actor: PlatformActor, q: PlatformChannelListQuery): Promise<PlatformChannel[]> {
    return guarded(() => this.repo.listChannels(actor.userId, q.status ?? null));
  }

  async listSubscriptionCharges(actor: PlatformActor, q: PlatformSubscriptionChargeQuery): Promise<PlatformSubscriptionChargeList> {
    return { items: await guarded(() => this.repo.listSubscriptionCharges(actor.userId, q)) };
  }

  async plans(actor: PlatformActor): Promise<PlatformPlans> {
    return guarded(async () => {
      const [counts, overrides] = await Promise.all([this.repo.planCounts(actor.userId), this.repo.limitOverrides(actor.userId)]);
      const plans = PLAN_IDS.map((id) => {
        const def = getPlan(id);
        const tenantsByStatus: Partial<Record<TenantStatus, number>> = {};
        for (const c of counts) if (c.plan === id) tenantsByStatus[c.status] = c.count;
        return {
          id,
          name: def.name,
          priceMonthlyUsd: def.priceMonthlyUsd,
          limits: { ...def.limits },
          tenantsByStatus,
          tenantCount: Object.values(tenantsByStatus).reduce((a, b) => a + (b ?? 0), 0),
        };
      });
      return { plans, overrides };
    });
  }

  async usage(actor: PlatformActor, q: PlatformUsageQuery): Promise<PlatformUsage> {
    const month = q.month ?? currentMonthUtc();
    const rows = await guarded(() => this.repo.usage(actor.userId, month));
    const items = rows.map(({ aiCostMicro, ...r }) => ({ ...r, aiCostUsd: microCentsToUsd(aiCostMicro) }));
    const sumMicro = rows.reduce((a, r) => a + BigInt(r.aiCostMicro), 0n);
    return {
      month,
      items,
      totals: {
        aiMessages: items.reduce((a, r) => a + r.aiMessages, 0),
        broadcastSends: items.reduce((a, r) => a + r.broadcastSends, 0),
        ttsCharacters: items.reduce((a, r) => a + r.ttsCharacters, 0),
        aiCostUsd: microCentsToUsd(sumMicro),
      },
    };
  }

  async audit(actor: PlatformActor, q: PlatformAuditQuery): Promise<PlatformAuditPage> {
    const page = q.page ?? 1;
    const range = dayRangeUtc(q.from, q.to);
    const res = await guarded(() =>
      this.repo.auditSearch(actor.userId, {
        actor: q.actor && q.actor.length > 0 ? q.actor : null,
        action: q.action && q.action.length > 0 ? q.action : null,
        tenantId: q.tenantId ?? null,
        ...range,
        limit: AUDIT_PAGE_SIZE,
        offset: (page - 1) * AUDIT_PAGE_SIZE,
      }),
    );
    return { items: res.items, total: res.total, page, pageSize: AUDIT_PAGE_SIZE };
  }

  /** Best effort: a mail failure never undoes the (already audited) status change. */
  private async notifyOwner(to: string, ownerName: string | null, tenantName: string, action: string, reason: string | null): Promise<void> {
    const ctx = emailContextFromEnv();
    const message =
      action === "approve"
        ? templateMessage(to, "cuenta-aprobada", { name: ownerName, tenantName, appUrl: siteLink(ctx, "/app") }, ctx)
        : action === "reject"
          ? templateMessage(to, "cuenta-rechazada", { name: ownerName, tenantName, reason }, ctx)
          : action === "suspend"
            ? templateMessage(to, "cuenta-suspendida", { name: ownerName, tenantName, reason }, ctx)
            : null;
    if (!message) return;
    try {
      await this.mailer.send(message);
    } catch (err) {
      this.logger.warn(`platform status mail failed: ${(err as Error).name}`);
    }
  }

}
