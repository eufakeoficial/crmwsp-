/**
 * Business category ("rubro") rules for onboarding (docs/research/politicas-meta-whatsapp-2026-10.md §3).
 * The rules themselves are data (`business_categories`, migration 0077); this module only decides
 * what a rule means. The same decision is repeated in SQL (`tenant_set_business_category`).
 */

export const categoryActions = ["block", "review", "warn", "allow"] as const;
export type CategoryAction = (typeof categoryActions)[number];

export const categoryReviewStatuses = ["none", "pending", "approved", "rejected"] as const;
export type CategoryReviewStatus = (typeof categoryReviewStatuses)[number];

export interface BusinessCategoryRule {
  key: string;
  label: string;
  action: CategoryAction;
  guidance: string | null;
  active: boolean;
}

export type CategoryDecision =
  | { outcome: "refused"; message: string }
  | { outcome: "pending_review"; message: string; guidance: string | null }
  | { outcome: "accepted"; guidance: string | null };

export const CATEGORY_REFUSED_MESSAGE =
  "Este rubro no está permitido por las políticas de WhatsApp Business, por eso no podemos activar la cuenta.";
export const CATEGORY_REVIEW_MESSAGE =
  "Este rubro requiere una revisión manual antes de conectar WhatsApp. Te avisaremos cuando esté aprobado.";

/** What choosing `rule` means for a tenant. An unknown or inactive category is refused. */
export function decideBusinessCategory(rule: BusinessCategoryRule | undefined): CategoryDecision {
  if (!rule || !rule.active) return { outcome: "refused", message: "Rubro desconocido." };
  switch (rule.action) {
    case "block":
      return { outcome: "refused", message: CATEGORY_REFUSED_MESSAGE };
    case "review":
      return { outcome: "pending_review", message: CATEGORY_REVIEW_MESSAGE, guidance: rule.guidance };
    case "warn":
    case "allow":
      return { outcome: "accepted", guidance: rule.guidance };
  }
}

/** Review status a tenant gets when it picks `rule` (mirrors the SQL function). */
export function reviewStatusFor(
  rule: BusinessCategoryRule,
  current: { category: string | null; status: CategoryReviewStatus },
): CategoryReviewStatus {
  if (rule.action !== "review") return "none";
  // Re-picking the category an admin already approved keeps the approval.
  if (current.status === "approved" && current.category === rule.key) return "approved";
  return "pending";
}

/** While a review is open (or was rejected) only a platform admin can change the category. */
export function canTenantChangeCategory(status: CategoryReviewStatus): boolean {
  return status === "none" || status === "approved";
}

/** WhatsApp can be connected unless the category review is pending or rejected. */
export function canConnectWhatsApp(status: CategoryReviewStatus): boolean {
  return status === "none" || status === "approved";
}
