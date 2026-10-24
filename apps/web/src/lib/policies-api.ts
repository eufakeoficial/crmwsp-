import {
  businessCategoryListResponseSchema,
  businessCategoryStateSchema,
  platformBusinessCategoryListSchema,
  platformCategoryReviewListSchema,
  platformQualityAlertListSchema,
  templateLintResponseSchema,
  type TemplateLintRequest,
  type CategoryReviewDecisionRequest,
  type SetBusinessCategoryRequest,
  type UpsertBusinessCategoryRequest,
} from "@crmwsp/contracts";
import { request } from "./api";

/** Business category (ADR 0021) for the signup form and the panel. */
export const categoriesApi = {
  list: () => request("/business-categories", { schema: businessCategoryListResponseSchema }),
  state: () => request("/settings/business-category", { schema: businessCategoryStateSchema }),
  set: (body: SetBusinessCategoryRequest) => request("/settings/business-category", { method: "PUT", body, schema: businessCategoryStateSchema }),
};

/** Pre-submit policy linter (ADR 0021): errors block the submission, warnings are advice. */
export const lintTemplateRemote = (body: TemplateLintRequest) =>
  request("/channels/templates/lint", { method: "POST", body, schema: templateLintResponseSchema });

/** Policy backoffice (ADR 0021). Non-admins get 404. */
export const policiesPlatformApi = {
  categories: () => request("/platform/business-categories", { schema: platformBusinessCategoryListSchema }),
  upsertCategory: (key: string, body: UpsertBusinessCategoryRequest) =>
    request(`/platform/business-categories/${encodeURIComponent(key)}`, { method: "PUT", body }),
  qualityAlerts: (days = 30) => request("/platform/channel-quality-alerts", { query: { days: String(days) }, schema: platformQualityAlertListSchema }),
  reviews: (status?: string) => request("/platform/category-reviews", { query: { status }, schema: platformCategoryReviewListSchema }),
  decide: (tenantId: string, body: CategoryReviewDecisionRequest) =>
    request(`/platform/category-reviews/${encodeURIComponent(tenantId)}`, { method: "POST", body }),
};

export const CATEGORY_ACTION_LABELS = { block: "Bloquear", review: "Revisión", warn: "Advertir", allow: "Permitir" } as const;
export const CATEGORY_REVIEW_LABELS = { none: "Sin revisión", pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado" } as const;
