import {
  type PlatformTenantListQuery,
  type RecordSubscriptionPaymentRequest,
  type SubscriptionPaymentListQuery,
  type TenantPlanChangeRequest,
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
  payments: (q: SubscriptionPaymentListQuery = {}) =>
    request("/platform/payments", { query: { tenantId: q.tenantId, month: q.month }, schema: subscriptionPaymentListSchema }),
  recordPayment: (body: RecordSubscriptionPaymentRequest) => request("/platform/payments", { method: "POST", body, schema: subscriptionPaymentSchema }),
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
