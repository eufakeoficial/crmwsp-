import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

// ---------- T2c: template linter ----------

/** POST /channels/templates/lint. */
export const templateLintRequestSchema = z.object({
  category: z.enum(["marketing", "utility", "authentication"]),
  body: z.string().trim().min(1).max(1024),
});
export type TemplateLintRequest = z.infer<typeof templateLintRequestSchema>;
export const templateLintIssueSchema = z.object({
  level: z.enum(["error", "warning"]),
  code: z.string(),
  message: z.string(),
});
export type TemplateLintIssueDto = z.infer<typeof templateLintIssueSchema>;
export const templateLintResponseSchema = z.object({ ok: z.boolean(), issues: z.array(templateLintIssueSchema) });
export type TemplateLintResponse = z.infer<typeof templateLintResponseSchema>;

// ---------- T2d: channel quality alerts (backoffice) ----------

export const platformQualityAlertQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).optional() });
export const platformQualityAlertSchema = z.object({
  eventId: uuidSchema,
  tenantId: uuidSchema,
  tenantName: z.string(),
  channelId: uuidSchema,
  provider: z.string(),
  phoneLast4: z.string(),
  field: z.string(),
  event: z.string().nullable(),
  quality: z.string().nullable(),
  reason: z.string().nullable(),
  severity: z.enum(["info", "warning", "critical"]),
  accountStatus: z.string(),
  createdAt: isoDateTimeSchema,
});
export type PlatformQualityAlert = z.infer<typeof platformQualityAlertSchema>;
export const platformQualityAlertListSchema = z.object({ items: z.array(platformQualityAlertSchema) });
export type PlatformQualityAlertList = z.infer<typeof platformQualityAlertListSchema>;

// ---------- T1: business category ("rubro") ----------

export const businessCategoryKeySchema = z.string().trim().regex(/^[a-z0-9_]{2,64}$/, "invalid category");
export const categoryActionSchema = z.enum(["block", "review", "warn", "allow"]);
export type CategoryActionDto = z.infer<typeof categoryActionSchema>;
export const categoryReviewStatusSchema = z.enum(["none", "pending", "approved", "rejected"]);
export type CategoryReviewStatusDto = z.infer<typeof categoryReviewStatusSchema>;

/** GET /business-categories (public: signup form). */
export const businessCategoryOptionSchema = z.object({
  key: z.string(),
  label: z.string(),
  action: categoryActionSchema,
  guidance: z.string().nullable(),
});
export type BusinessCategoryOption = z.infer<typeof businessCategoryOptionSchema>;
export const businessCategoryListResponseSchema = z.object({ items: z.array(businessCategoryOptionSchema) });
export type BusinessCategoryListResponse = z.infer<typeof businessCategoryListResponseSchema>;

/** PUT /settings/business-category. */
export const setBusinessCategoryRequestSchema = z.object({
  category: businessCategoryKeySchema,
  detail: z.string().trim().max(200).optional(),
});
export type SetBusinessCategoryRequest = z.infer<typeof setBusinessCategoryRequestSchema>;

/** GET /settings/business-category: the tenant's current category state. */
export const businessCategoryStateSchema = z.object({
  category: z.string().nullable(),
  label: z.string().nullable(),
  action: categoryActionSchema.nullable(),
  detail: z.string().nullable(),
  reviewStatus: categoryReviewStatusSchema,
  reviewReason: z.string().nullable(),
  guidance: z.string().nullable(),
  /** False while the review is pending or rejected. */
  canConnectWhatsApp: z.boolean(),
});
export type BusinessCategoryState = z.infer<typeof businessCategoryStateSchema>;

export const platformBusinessCategorySchema = businessCategoryOptionSchema.extend({
  sortOrder: z.number().int(),
  active: z.boolean(),
  updatedAt: isoDateTimeSchema,
  tenantCount: z.number().int(),
});
export type PlatformBusinessCategory = z.infer<typeof platformBusinessCategorySchema>;
export const platformBusinessCategoryListSchema = z.object({ items: z.array(platformBusinessCategorySchema) });
export type PlatformBusinessCategoryList = z.infer<typeof platformBusinessCategoryListSchema>;

/** PUT /platform/business-categories/:key — never re-evaluates existing tenants. */
export const upsertBusinessCategoryRequestSchema = z.object({
  label: z.string().trim().min(1).max(120),
  action: categoryActionSchema,
  guidance: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
});
export type UpsertBusinessCategoryRequest = z.infer<typeof upsertBusinessCategoryRequestSchema>;

export const platformCategoryReviewQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "none", "unset"]).optional(),
});
export const platformCategoryReviewSchema = z.object({
  tenantId: uuidSchema,
  name: z.string(),
  slug: z.string(),
  tenantStatus: z.string(),
  category: z.string().nullable(),
  categoryLabel: z.string().nullable(),
  categoryAction: categoryActionSchema.nullable(),
  detail: z.string().nullable(),
  reviewStatus: categoryReviewStatusSchema,
  reviewReason: z.string().nullable(),
  setAt: isoDateTimeSchema.nullable(),
  ownerEmail: z.string().nullable(),
});
export type PlatformCategoryReview = z.infer<typeof platformCategoryReviewSchema>;
export const platformCategoryReviewListSchema = z.object({ items: z.array(platformCategoryReviewSchema) });
export type PlatformCategoryReviewList = z.infer<typeof platformCategoryReviewListSchema>;

export const categoryReviewDecisionRequestSchema = z
  .object({ approve: z.boolean(), reason: z.string().trim().max(500).optional() })
  .refine((v) => v.approve || (v.reason ?? "").length > 0, { message: "A reason is required to reject", path: ["reason"] });
export type CategoryReviewDecisionRequest = z.infer<typeof categoryReviewDecisionRequestSchema>;
