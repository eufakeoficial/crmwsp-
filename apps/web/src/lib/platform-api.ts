import {
  type PlatformAuditQuery,
  type PlatformChannelListQuery,
  type PlatformChannelStatus,
  type PlatformUsageQuery,
  type PlatformUserListQuery,
  platformAuditPageSchema,
  platformChannelListSchema,
  platformPlansSchema,
  platformUsageSchema,
  platformUserListSchema,
  platformUserSchema,
  revokeSessionsResponseSchema,
  type PlatformTenantListQuery,
  type RecordSubscriptionPaymentRequest,
  type SubscriptionPaymentListQuery,
  type TenantPlanChangeRequest,
  type TenantLifecycleExtendRequest,
  tenantLifecycleExtendResponseSchema,
  type TenantStatus,
  type TenantStatusChangeRequest,
  platformDashboardSchema,
  platformMeResponseSchema,
  platformSettingsSchema,
  platformTenantDetailSchema,
  platformTenantListSchema,
  platformTenantSchema,
  subscriptionPaymentListSchema,
  subscriptionPaymentSchema,
} from "@crmwsp/contracts";
import { ApiError, request } from "./api";

/** SaaS backoffice API (/platform). Non-admins get 404 on everything except `me`. */
export const platformApi = {
  me: () => request("/platform/me", { schema: platformMeResponseSchema }),
  dashboard: () => request("/platform/dashboard", { schema: platformDashboardSchema }),
  tenants: (q: PlatformTenantListQuery = {}) =>
    request("/platform/tenants", { query: { q: q.q, status: q.status, plan: q.plan }, schema: platformTenantListSchema }),
  tenant: (id: string) => request(`/platform/tenants/${encodeURIComponent(id)}`, { schema: platformTenantDetailSchema }),
  changeStatus: (id: string, body: TenantStatusChangeRequest) =>
    request(`/platform/tenants/${encodeURIComponent(id)}/status`, { method: "POST", body, schema: platformTenantSchema }),
  changePlan: (id: string, body: TenantPlanChangeRequest) =>
    request(`/platform/tenants/${encodeURIComponent(id)}/plan`, { method: "PUT", body, schema: platformTenantSchema }),
  extendLifecycle: (id: string, body: TenantLifecycleExtendRequest) =>
    request(`/platform/tenants/${encodeURIComponent(id)}/lifecycle`, { method: "POST", body, schema: tenantLifecycleExtendResponseSchema }),
  payments: (q: SubscriptionPaymentListQuery = {}) =>
    request("/platform/payments", { query: { tenantId: q.tenantId, month: q.month }, schema: subscriptionPaymentListSchema }),
  recordPayment: (body: RecordSubscriptionPaymentRequest) => request("/platform/payments", { method: "POST", body, schema: subscriptionPaymentSchema }),
  users: (q: PlatformUserListQuery = {}) => request("/platform/users", { query: { q: q.q }, schema: platformUserListSchema }),
  user: (id: string) => request(`/platform/users/${encodeURIComponent(id)}`, { schema: platformUserSchema }),
  revokeSessions: (id: string) =>
    request(`/platform/users/${encodeURIComponent(id)}/revoke-sessions`, { method: "POST", schema: revokeSessionsResponseSchema }),
  channels: (q: PlatformChannelListQuery = {}) => request("/platform/channels", { query: { status: q.status }, schema: platformChannelListSchema }),
  plans: () => request("/platform/plans", { schema: platformPlansSchema }),
  usage: (q: PlatformUsageQuery = {}) => request("/platform/usage", { query: { month: q.month }, schema: platformUsageSchema }),
  audit: (q: PlatformAuditQuery = {}) =>
    request("/platform/audit", {
      query: { actor: q.actor, action: q.action, tenantId: q.tenantId, from: q.from, to: q.to, page: q.page === undefined ? undefined : String(q.page) },
      schema: platformAuditPageSchema,
    }),
  settings: () => request("/platform/settings", { schema: platformSettingsSchema }),
  updateSettings: (requireApproval: boolean) =>
    request("/platform/settings", { method: "PATCH", body: { requireApproval }, schema: platformSettingsSchema }),
};

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  active: "Activa",
  pending_approval: "Pendiente",
  rejected: "Rechazada",
  suspended: "Suspendida",
};

export const CHANNEL_STATUS_LABELS: Record<PlatformChannelStatus, string> = {
  pending: "Pendiente",
  active: "Activo",
  disabled: "Desactivado",
};

export const ROLE_LABELS: Record<string, string> = { owner: "Propietario", admin: "Admin", agent: "Agente", viewer: "Lector" };

/** Human labels for platform audit actions (unknown actions show the raw key). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "tenant.approve": "Empresa aprobada",
  "tenant.reject": "Empresa rechazada",
  "tenant.suspend": "Empresa suspendida",
  "tenant.reactivate": "Empresa reactivada",
  "tenant.plan_changed": "Plan cambiado",
  "subscription_payment.recorded": "Pago registrado",
  "settings.require_approval": "Ajuste de aprobación",
  "user.sessions_revoked": "Sesiones revocadas",
};

/** Previous calendar months `YYYY-MM` (UTC), newest first, starting with the current one. */
export function recentMonths(count: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("es", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 }).format(value);
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  transfer: "Transferencia",
  cash: "Efectivo",
  card_manual: "Tarjeta (manual)",
  mercadopago: "Mercado Pago",
  stripe: "Stripe",
};

export const ACTION_LABELS: Record<"approve" | "reject" | "suspend" | "reactivate", string> = {
  approve: "Aprobar",
  reject: "Rechazar",
  suspend: "Suspender",
  reactivate: "Reactivar",
};

/** Same rule as @crmwsp/domain (the web does not depend on it): reject/suspend need a reason. */
export function actionRequiresReason(action: string): boolean {
  return action === "reject" || action === "suspend";
}

/** Status actions available per status (mirror of @crmwsp/domain `availableTenantActions`). */
export const STATUS_ACTIONS: Record<TenantStatus, readonly ("approve" | "reject" | "suspend" | "reactivate")[]> = {
  pending_approval: ["approve", "reject"],
  active: ["suspend"],
  suspended: ["reactivate"],
  rejected: ["reactivate"],
};

/** Spanish messages for the backoffice screens. */
export function platformErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Ocurrió un error inesperado. Inténtalo de nuevo.";
  switch (err.code) {
    case "NOT_FOUND":
      return "No se encontró el recurso.";
    case "CONFLICT":
      return "Esa acción no está permitida en el estado actual de la empresa.";
    case "VALIDATION_ERROR":
      return "Revisa los datos introducidos.";
    case "RATE_LIMITED":
      return "Demasiadas peticiones. Espera unos minutos.";
    default:
      return "Ocurrió un error en el servidor. Inténtalo más tarde.";
  }
}
