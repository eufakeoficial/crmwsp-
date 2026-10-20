import { Inject, Injectable, Logger } from "@nestjs/common";
import { getPlan, isPlanId } from "@crmwsp/billing";
import {
  ConflictError,
  NotFoundError,
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
  type TenantStatusChangeRequest,
  ValidationError,
} from "@crmwsp/contracts";
import { estimateMrr } from "@crmwsp/domain";
import { type Mailer, renderEmail } from "@crmwsp/mailer";
import { pgCode } from "../inbox/audit.js";
import { publicWebUrl } from "../team/invitation-token.js";
import { PlatformRepository } from "./platform.repository.js";

/** Nest injection token for the mailer used by the platform module. */
export const PLATFORM_MAILER = Symbol("PLATFORM_MAILER");

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

  listTenants(actor: PlatformActor, q: PlatformTenantListQuery): Promise<PlatformTenant[]> {
    return guarded(() => this.repo.listTenants(actor.userId, q));
  }

  async tenantDetail(actor: PlatformActor, tenantId: string): Promise<PlatformTenantDetail> {
    return guarded(async () => {
      const [tenant] = await this.repo.listTenants(actor.userId, { tenantId });
      if (!tenant) throw new NotFoundError();
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

  /** Best effort: a mail failure never undoes the (already audited) status change. */
  private async notifyOwner(to: string, ownerName: string | null, tenantName: string, action: string, reason: string | null): Promise<void> {
    const hello = ownerName ? `Hola ${ownerName},` : "Hola,";
    const copy: Record<string, { subject: string; title: string; body: string; cta?: string }> = {
      approve: {
        subject: `Tu cuenta ${tenantName} está aprobada`,
        title: "Cuenta aprobada",
        body: `${hello}\n\nHemos revisado y aprobado la cuenta de ${tenantName}. Ya puedes conectar tus canales y usar la IA.`,
        cta: "Entrar al panel",
      },
      reject: {
        subject: `Tu solicitud para ${tenantName} no fue aprobada`,
        title: "Solicitud no aprobada",
        body: `${hello}\n\nTras revisar la cuenta de ${tenantName}, no podemos aprobarla por ahora.${reason ? `\n\nMotivo: ${reason}` : ""}\n\nSi crees que es un error, responde a este correo.`,
      },
      suspend: {
        subject: `La cuenta ${tenantName} está suspendida`,
        title: "Cuenta suspendida",
        body: `${hello}\n\nHemos suspendido la cuenta de ${tenantName}. Mientras siga suspendida no se procesan mensajes ni se usa la IA.${reason ? `\n\nMotivo: ${reason}` : ""}\n\nResponde a este correo para regularizarla.`,
      },
    };
    const c = copy[action];
    if (!c) return;
    try {
      const { text, html } = renderEmail({
        title: c.title,
        body: c.body,
        ...(c.cta ? { ctaLabel: c.cta, ctaUrl: `${publicWebUrl()}/app` } : {}),
      });
      await this.mailer.send({ to, subject: c.subject.slice(0, 200), text, html });
    } catch (err) {
      this.logger.warn(`platform status mail failed: ${(err as Error).name}`);
    }
  }
}
