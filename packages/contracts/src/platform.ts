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

/** Methods of listed payments: the manual ones plus `nowpayments` (settled crypto charges, ADR 0013). */
export const subscriptionPaymentListedMethodSchema = z.enum(["transfer", "cash", "card_manual", "mercadopago", "stripe", "nowpayments"]);
export type SubscriptionPaymentListedMethod = z.infer<typeof subscriptionPaymentListedMethodSchema>;

export const subscriptionPaymentSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  tenantName: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  method: subscriptionPaymentListedMethodSchema,
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

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month (YYYY-MM)");

/** Backoffice: users across tenants (no credentials, no session tokens). */
export const platformUserSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  name: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  lastLoginAt: isoDateTimeSchema.nullable(),
  activeSessions: z.number().int(),
  isPlatformAdmin: z.boolean(),
  tenants: z.array(z.object({ tenantId: uuidSchema, name: z.string(), role: membershipRoleSchema })),
});
export type PlatformUser = z.infer<typeof platformUserSchema>;

export const platformUserListQuerySchema = z.object({ q: z.string().trim().max(200).optional() });
export type PlatformUserListQuery = z.infer<typeof platformUserListQuerySchema>;

export const platformUserListSchema = z.object({ items: z.array(platformUserSchema) });
export type PlatformUserList = z.infer<typeof platformUserListSchema>;

export const revokeSessionsResponseSchema = z.object({ revoked: z.number().int() });
export type RevokeSessionsResponse = z.infer<typeof revokeSessionsResponseSchema>;

/** Backoffice: BSP channel connections. Only the last 4 digits of the number are exposed. */
export const platformChannelStatusSchema = z.enum(["pending", "active", "disabled"]);
export type PlatformChannelStatus = z.infer<typeof platformChannelStatusSchema>;

export const platformChannelSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  tenantName: z.string(),
  provider: z.string(),
  phoneLast4: z.string(),
  status: platformChannelStatusSchema,
  createdAt: isoDateTimeSchema,
  lastInboundAt: isoDateTimeSchema.nullable(),
  lastOutboundAt: isoDateTimeSchema.nullable(),
  failedLast7d: z.number().int(),
});
export type PlatformChannel = z.infer<typeof platformChannelSchema>;

export const platformChannelListQuerySchema = z.object({ status: platformChannelStatusSchema.optional() });
export type PlatformChannelListQuery = z.infer<typeof platformChannelListQuerySchema>;

export const platformChannelListSchema = z.object({ items: z.array(platformChannelSchema) });
export type PlatformChannelList = z.infer<typeof platformChannelListSchema>;

/** Backoffice: plan catalog (from @crmwsp/billing) + tenants per plan + per-tenant overrides. */
export const platformPlanSchema = z.object({
  id: platformPlanIdSchema,
  name: z.string(),
  priceMonthlyUsd: z.number(),
  limits: z.record(z.string(), z.number().int().nullable()),
  tenantsByStatus: z.partialRecord(tenantStatusSchema, z.number().int()),
  tenantCount: z.number().int(),
});
export type PlatformPlan = z.infer<typeof platformPlanSchema>;

export const platformLimitOverrideSchema = z.object({
  tenantId: uuidSchema,
  name: z.string(),
  slug: z.string(),
  status: tenantStatusSchema,
  plan: platformPlanIdSchema,
  limitsOverride: limitsOverrideSchema,
  updatedAt: isoDateTimeSchema,
});
export type PlatformLimitOverride = z.infer<typeof platformLimitOverrideSchema>;

export const platformPlansSchema = z.object({ plans: z.array(platformPlanSchema), overrides: z.array(platformLimitOverrideSchema) });
export type PlatformPlans = z.infer<typeof platformPlansSchema>;

/** Backoffice: usage per tenant in a month. AI cost in USD (ledger micro-cents converted). */
export const platformUsageQuerySchema = z.object({ month: monthSchema.optional() });
export type PlatformUsageQuery = z.infer<typeof platformUsageQuerySchema>;

export const platformUsageRowSchema = z.object({
  tenantId: uuidSchema,
  name: z.string(),
  slug: z.string(),
  plan: platformPlanIdSchema,
  aiMessages: z.number().int(),
  broadcastSends: z.number().int(),
  ttsCharacters: z.number().int(),
  aiCostUsd: z.number(),
});
export type PlatformUsageRow = z.infer<typeof platformUsageRowSchema>;

export const platformUsageSchema = z.object({
  month: monthSchema,
  items: z.array(platformUsageRowSchema),
  totals: z.object({ aiMessages: z.number().int(), broadcastSends: z.number().int(), ttsCharacters: z.number().int(), aiCostUsd: z.number() }),
});
export type PlatformUsage = z.infer<typeof platformUsageSchema>;

/** Backoffice: audit log search (offset pagination). `from`/`to` are inclusive days (UTC). */
export const platformAuditQuerySchema = z.object({
  actor: z.string().trim().max(200).optional(),
  action: z.string().trim().max(100).optional(),
  tenantId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
});
export type PlatformAuditQuery = z.infer<typeof platformAuditQuerySchema>;

export const platformAuditEntrySchema = platformAuditEventSchema.extend({ tenantName: z.string().nullable() });
export type PlatformAuditEntry = z.infer<typeof platformAuditEntrySchema>;

export const platformAuditPageSchema = z.object({
  items: z.array(platformAuditEntrySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type PlatformAuditPage = z.infer<typeof platformAuditPageSchema>;

/** `GET /platform/subscription-charges`: NOWPayments invoices of every tenant (ADR 0013). */
export const platformSubscriptionChargeQuerySchema = z.object({
  tenantId: uuidSchema.optional(),
  status: z.enum(["pending", "paid", "failed", "expired", "refunded"]).optional(),
});
export type PlatformSubscriptionChargeQuery = z.infer<typeof platformSubscriptionChargeQuerySchema>;

export const platformSubscriptionChargeSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  tenantName: z.string(),
  plan: platformPlanIdSchema,
  priceAmount: z.string(),
  priceCurrency: z.string(),
  payCurrency: z.string(),
  payAmount: z.string().nullable(),
  actuallyPaid: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  status: z.enum(["pending", "paid", "failed", "expired", "refunded"]),
  providerStatus: z.string().nullable(),
  verifiedBy: z.enum(["webhook", "reconciliation"]).nullable(),
  paidAt: isoDateTimeSchema.nullable(),
  periodStart: isoDateSchema.nullable(),
  periodEnd: isoDateSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type PlatformSubscriptionCharge = z.infer<typeof platformSubscriptionChargeSchema>;

export const platformSubscriptionChargeListSchema = z.object({ items: z.array(platformSubscriptionChargeSchema) });
export type PlatformSubscriptionChargeList = z.infer<typeof platformSubscriptionChargeListSchema>;
