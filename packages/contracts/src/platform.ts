import { z } from "zod";
import { membershipRoleSchema, tenantStatusSchema } from "./auth.js";
import { currencySchema, isoDateTimeSchema, uuidSchema } from "./common.js";

/** SaaS platform backoffice (ADR 0011). Every `/platform/*` route except `/platform/me` is admin-only. */

export const platformMeResponseSchema = z.object({ isPlatformAdmin: z.boolean() });
export type PlatformMeResponse = z.infer<typeof platformMeResponseSchema>;

export const platformPlanIdSchema = z.enum(["start", "pro"]);
export type PlatformPlanId = z.infer<typeof platformPlanIdSchema>;

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date (YYYY-MM-DD)");

/** Per-tenant overrides of plan limits (`null` = unlimited). Keys mirror @crmwsp/billing LIMIT_KEYS. */
export const limitsOverrideSchema = z
  .object({
    ai_messages: z.number().int().min(0).max(100_000_000).nullable(),
    contacts: z.number().int().min(0).max(100_000_000).nullable(),
    seats: z.number().int().min(0).max(10_000).nullable(),
    broadcast_sends: z.number().int().min(0).max(100_000_000).nullable(),
    whatsapp_numbers: z.number().int().min(0).max(1_000).nullable(),
  })
  .partial()
  .strict();
export type LimitsOverride = z.infer<typeof limitsOverrideSchema>;

export const platformTenantSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  status: tenantStatusSchema,
  statusReason: z.string().nullable(),
  plan: platformPlanIdSchema,
  limitsOverride: limitsOverrideSchema.nullable(),
  createdAt: isoDateTimeSchema,
  ownerEmail: z.string().nullable(),
  ownerName: z.string().nullable(),
  memberCount: z.number().int(),
  seats: z.number().int(),
  usagePeriod: z.string(),
  aiMessages: z.number().int(),
  broadcastSends: z.number().int(),
  channelCount: z.number().int(),
  lastActivityAt: isoDateTimeSchema.nullable(),
  paidUntil: isoDateSchema.nullable(),
  overdue: z.boolean(),
});
export type PlatformTenant = z.infer<typeof platformTenantSchema>;

export const platformTenantListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: tenantStatusSchema.optional(),
  plan: platformPlanIdSchema.optional(),
});
export type PlatformTenantListQuery = z.infer<typeof platformTenantListQuerySchema>;

export const platformTenantListSchema = z.object({ items: z.array(platformTenantSchema) });
export type PlatformTenantList = z.infer<typeof platformTenantListSchema>;

export const platformAuditEventSchema = z.object({
  id: uuidSchema,
  actorEmail: z.string().nullable(),
  action: z.string(),
  tenantId: uuidSchema.nullable(),
  diff: z.record(z.string(), z.unknown()),
  createdAt: isoDateTimeSchema,
});
export type PlatformAuditEvent = z.infer<typeof platformAuditEventSchema>;

export const subscriptionPaymentMethodSchema = z.enum(["transfer", "cash", "card_manual", "mercadopago", "stripe"]);
export type SubscriptionPaymentMethod = z.infer<typeof subscriptionPaymentMethodSchema>;

export const subscriptionPaymentSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  tenantName: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  method: subscriptionPaymentMethodSchema,
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  recordedByEmail: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type SubscriptionPayment = z.infer<typeof subscriptionPaymentSchema>;

export const platformTenantDetailSchema = z.object({
  tenant: platformTenantSchema,
  members: z.array(z.object({ name: z.string().nullable(), email: z.string(), role: membershipRoleSchema })),
  channels: z.array(z.object({ id: uuidSchema, status: z.string(), createdAt: isoDateTimeSchema })),
  payments: z.array(subscriptionPaymentSchema),
  audit: z.array(platformAuditEventSchema),
});
export type PlatformTenantDetail = z.infer<typeof platformTenantDetailSchema>;

export const tenantStatusActionSchema = z.enum(["approve", "reject", "suspend", "reactivate"]);
export type TenantStatusAction = z.infer<typeof tenantStatusActionSchema>;

export const tenantStatusChangeRequestSchema = z
  .object({ action: tenantStatusActionSchema, reason: z.string().trim().max(500).optional() })
  .refine((v) => (v.action !== "reject" && v.action !== "suspend") || (v.reason ?? "").length > 0, {
    message: "A reason is required to reject or suspend",
    path: ["reason"],
  });
export type TenantStatusChangeRequest = z.infer<typeof tenantStatusChangeRequestSchema>;

export const tenantPlanChangeRequestSchema = z.object({
  plan: platformPlanIdSchema,
  limitsOverride: limitsOverrideSchema.nullable().optional(),
});
export type TenantPlanChangeRequest = z.infer<typeof tenantPlanChangeRequestSchema>;

export const recordSubscriptionPaymentRequestSchema = z
  .object({
    tenantId: uuidSchema,
    amountMinor: z.number().int().positive().max(100_000_000_000),
    currency: currencySchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    method: subscriptionPaymentMethodSchema,
    reference: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "periodEnd must be on or after periodStart", path: ["periodEnd"] });
export type RecordSubscriptionPaymentRequest = z.infer<typeof recordSubscriptionPaymentRequestSchema>;

export const subscriptionPaymentListQuerySchema = z.object({
  tenantId: uuidSchema.optional(),
  /** `YYYY-MM`: payments recorded in that calendar month (UTC). */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});
export type SubscriptionPaymentListQuery = z.infer<typeof subscriptionPaymentListQuerySchema>;

export const monthlyPaymentTotalSchema = z.object({
  month: z.string(),
  currency: z.string(),
  totalMinor: z.number().int(),
  count: z.number().int(),
});
export type MonthlyPaymentTotal = z.infer<typeof monthlyPaymentTotalSchema>;

export const subscriptionPaymentListSchema = z.object({
  items: z.array(subscriptionPaymentSchema),
  totals: z.array(monthlyPaymentTotalSchema),
});
export type SubscriptionPaymentList = z.infer<typeof subscriptionPaymentListSchema>;

export const platformDashboardSchema = z.object({
  byStatus: z.partialRecord(tenantStatusSchema, z.number().int()),
  activeByPlan: z.partialRecord(platformPlanIdSchema, z.number().int()),
  /** Estimate: active tenants x list monthly price of their plan (USD, no discounts). */
  mrrEstimateUsd: z.number(),
  paymentsThisMonth: z.array(monthlyPaymentTotalSchema),
  overdue: z.number().int(),
});
export type PlatformDashboard = z.infer<typeof platformDashboardSchema>;

export const platformSettingsSchema = z.object({ requireApproval: z.boolean(), updatedAt: isoDateTimeSchema.nullable() });
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const updatePlatformSettingsRequestSchema = z.object({ requireApproval: z.boolean() });
export type UpdatePlatformSettingsRequest = z.infer<typeof updatePlatformSettingsRequestSchema>;
