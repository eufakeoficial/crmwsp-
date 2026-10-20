import type { TenantStatus, TenantStatusAction } from "@crmwsp/contracts";

/**
 * Tenant lifecycle rules of the platform backoffice (ADR 0011). Mirrored in SQL by
 * `platform_set_tenant_status` (migration 0052): keep both in sync.
 */
const TRANSITIONS: Record<TenantStatusAction, { from: readonly TenantStatus[]; to: TenantStatus }> = {
  approve: { from: ["pending_approval"], to: "active" },
  reject: { from: ["pending_approval"], to: "rejected" },
  suspend: { from: ["active"], to: "suspended" },
  reactivate: { from: ["suspended", "rejected"], to: "active" },
};

/** Target status of `action` from `from`, or `null` when the transition is not allowed. */
export function nextTenantStatus(from: TenantStatus, action: TenantStatusAction): TenantStatus | null {
  const t = TRANSITIONS[action];
  return t.from.includes(from) ? t.to : null;
}

/** Actions available for a tenant in `status` (what the backoffice shows). */
export function availableTenantActions(status: TenantStatus): TenantStatusAction[] {
  return (Object.keys(TRANSITIONS) as TenantStatusAction[]).filter((a) => nextTenantStatus(status, a) !== null);
}

export function actionRequiresReason(action: TenantStatusAction): boolean {
  return action === "reject" || action === "suspend";
}

/** Can members of a tenant in this status use the panel API, channels and AI? */
export function isTenantOperational(status: TenantStatus | undefined): boolean {
  return status === undefined || status === "active";
}

/** Days of grace before a never-paid active tenant counts as overdue (same as SQL). */
export const OVERDUE_GRACE_DAYS = 14;

/**
 * Overdue = active tenant whose paid period ended before `today`, or that never paid and was
 * created more than OVERDUE_GRACE_DAYS ago. Dates are `YYYY-MM-DD` / Date.
 */
export function isOverdue(input: { status: TenantStatus; paidUntil: string | null; createdAt: Date }, now: Date = new Date()): boolean {
  if (input.status !== "active") return false;
  const today = now.toISOString().slice(0, 10);
  if (input.paidUntil !== null) return input.paidUntil < today;
  return now.getTime() - input.createdAt.getTime() > OVERDUE_GRACE_DAYS * 86_400_000;
}

/** MRR estimate: active tenants per plan x the plan's monthly list price. */
export function estimateMrr(activeByPlan: Partial<Record<string, number>>, monthlyPrice: (plan: string) => number | undefined): number {
  let total = 0;
  for (const [plan, count] of Object.entries(activeByPlan)) total += (count ?? 0) * (monthlyPrice(plan) ?? 0);
  return total;
}
