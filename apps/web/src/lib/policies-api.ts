import {
  businessCategoryListResponseSchema,
  businessCategoryStateSchema,
  platformBusinessCategoryListSchema,
  platformCategoryReviewListSchema,
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

/** Policy backoffice (ADR 0021). Non-admins get 404. */
export const policiesPlatformApi = {
  categories: () => request("/platform/business-categories", { schema: platformBusinessCategoryListSchema }),
  upsertCategory: (key: string, body: UpsertBusinessCategoryRequest) =>
    request(`/platform/business-categories/${encodeURIComponent(key)}`, { method: "PUT", body }),
  reviews: (status?: string) => request("/platform/category-reviews", { query: { status }, schema: platformCategoryReviewListSchema }),
  decide: (tenantId: string, body: CategoryReviewDecisionRequest) =>
    request(`/platform/category-reviews/${encodeURIComponent(tenantId)}`, { method: "POST", body }),
};

export const CATEGORY_ACTION_LABELS = { block: "Bloquear", review: "Revisión", warn: "Advertir", allow: "Permitir" } as const;
export const CATEGORY_REVIEW_LABELS = { none: "Sin revisión", pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado" } as const;
