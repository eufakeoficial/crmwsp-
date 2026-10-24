import { z } from "zod";

/** BullMQ queue shared by the API (producer) and the worker for subscription settlement (ADR 0013). */
export const SUBSCRIPTION_BILLING_QUEUE_NAME = "subscription-billing";
/** Job: settle one persisted NOWPayments event. Data: `{ eventId, tenantId }`. */
export const SETTLE_SUBSCRIPTION_EVENT_JOB = "settle-subscription-event";

/** IPN body fields used for ingestion (the full verified body is stored as-is). */
export const nowPaymentsIpnSchema = z
  .object({
    payment_id: z.union([z.number().int().positive(), z.string().regex(/^\d{1,30}$/)]),
    payment_status: z.string().min(1).max(40),
    order_id: z.string().max(100).nullable().optional(),
  })
  .passthrough();
export type NowPaymentsIpn = z.infer<typeof nowPaymentsIpnSchema>;

export const planLimitKeySchema = z.enum(["ai_messages", "contacts", "seats", "broadcast_sends", "whatsapp_numbers"]);
export type PlanLimitKeyDto = z.infer<typeof planLimitKeySchema>;

/** `GET /billing/plan`. `limit: null` = unlimited, `0` = not included in the plan. */
export const billingPlanResponseSchema = z.object({
  plan: z.object({
    id: z.enum(["start", "pro"]),
    name: z.string(),
    priceMonthlyUsd: z.number(),
    priceAnnualUsd: z.number(),
  }),
  /** `YYYY-MM` in the tenant time zone; monthly limits reset at its end. */
  period: z.string(),
  usage: z.array(
    z.object({
      key: planLimitKeySchema,
      monthly: z.boolean(),
      limit: z.number().int().nullable(),
      used: z.number().int(),
      percent: z.number().int().nullable(),
      /** Used above the limit (inbound contacts are never blocked, ADR 0015). */
      exceeded: z.boolean(),
    }),
  ),
  /** `nowpayments` when crypto subscription charging is configured on the server (ADR 0013). */
  billingProvider: z.enum(["none", "nowpayments"]),
  subscription: z.object({
    /** `unbilled` = never paid through the platform (not restricted). */
    /** `payment_required`: the WhatsApp number already used its free trial (ADR 0015). */
    access: z.enum(["unbilled", "active", "grace", "restricted", "setup", "trial", "payment_required"]),
    /** Last paid day (`YYYY-MM-DD`, UTC), `null` when never paid. */
    paidUntil: z.string().nullable(),
    graceDays: z.number().int(),
    /** Trial lifecycle (ADR 0015); null for grandfathered tenants. ISO timestamps. */
    setupEndsAt: z.string().nullable(),
    trialEndsAt: z.string().nullable(),
    /** Days left in setup or trial (null in any other state). */
    daysLeft: z.number().int().nullable(),
  }),
});
export type BillingPlanResponse = z.infer<typeof billingPlanResponseSchema>;

export const subscriptionChargeStatusSchema = z.enum(["pending", "paid", "failed", "expired", "refunded"]);
export type SubscriptionChargeStatus = z.infer<typeof subscriptionChargeStatusSchema>;

export const billingPeriodSchema = z.enum(["monthly", "annual"]);
export type BillingPeriodDto = z.infer<typeof billingPeriodSchema>;

/**
 * `POST /billing/subscription/charges`: pay one period of `plan` in crypto: `monthly` (30 days,
 * default) or `annual` (365 days at the annual price, ADR 0015).
 */
export const createSubscriptionChargeRequestSchema = z
  .object({
    plan: z.enum(["start", "pro"]),
    period: billingPeriodSchema.default("monthly"),
    /** Optional coupon (ADR 0017); the server computes the final price. */
    couponCode: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type CreateSubscriptionChargeRequest = z.infer<typeof createSubscriptionChargeRequestSchema>;

/** A NOWPayments invoice as shown to the tenant (address/amount to pay, QR payload, status). */
export const subscriptionChargeSchema = z.object({
  id: z.string().uuid(),
  plan: z.enum(["start", "pro"]),
  period: billingPeriodSchema,
  status: subscriptionChargeStatusSchema,
  /** Provider status (`waiting`, `confirming`, `partially_paid`, ...), informational. */
  providerStatus: z.string().nullable(),
  priceAmount: z.string(),
  priceCurrency: z.string(),
  payCurrency: z.string(),
  payAmount: z.string().nullable(),
  payAddress: z.string().nullable(),
  actuallyPaid: z.string().nullable(),
  /** Text to encode in a QR code (the deposit address). */
  qrData: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  /** List price before discounts (null on charges created before ADR 0017). */
  listPriceAmount: z.string().nullable(),
  discountAmount: z.string(),
  couponCode: z.string().nullable(),
  referralCredits: z.number().int(),
  /** `coupon` = granted without payment (100% discount or free days, ADR 0017). */
  verifiedBy: z.enum(["webhook", "reconciliation", "coupon"]).nullable(),
  periodDays: z.number().int(),
  createdAt: z.string(),
});
export type SubscriptionChargeDto = z.infer<typeof subscriptionChargeSchema>;

export const subscriptionChargeListSchema = z.object({ items: z.array(subscriptionChargeSchema) });
export type SubscriptionChargeList = z.infer<typeof subscriptionChargeListSchema>;

export const couponIneligibilitySchema = z.enum([
  "not_found",
  "inactive",
  "not_started",
  "expired",
  "plan_not_applicable",
  "period_not_applicable",
  "exhausted",
  "tenant_limit",
]);
export type CouponIneligibilityDto = z.infer<typeof couponIneligibilitySchema>;

/** `POST /billing/subscription/quote`: price preview (same computation as charge creation). */
export const subscriptionQuoteRequestSchema = createSubscriptionChargeRequestSchema;
export const subscriptionQuoteSchema = z.object({
  plan: z.enum(["start", "pro"]),
  period: billingPeriodSchema,
  listPrice: z.string(),
  discount: z.string(),
  finalPrice: z.string(),
  freeDays: z.number().int(),
  /** Nothing to pay: confirming grants the period / days directly. */
  free: z.boolean(),
  coupon: z.object({ code: z.string(), type: z.enum(["percent", "fixed_usd", "free_days"]), value: z.number() }).nullable(),
  /** Set when a coupon code was given and cannot be used (price then has no discount). */
  couponError: couponIneligibilitySchema.nullable(),
  /** Referral credits applied (20% each, monthly only, never with a coupon). */
  referralCredits: z.number().int(),
});
export type SubscriptionQuote = z.infer<typeof subscriptionQuoteSchema>;

// ---------- Platform coupons (ADR 0017) ----------

export const couponTypeSchema = z.enum(["percent", "fixed_usd", "free_days"]);
export const couponPeriodSchema = z.enum(["monthly", "annual", "any"]);

export const platformCouponSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  type: couponTypeSchema,
  value: z.number(),
  plans: z.array(z.enum(["start", "pro"])),
  period: couponPeriodSchema,
  maxRedemptions: z.number().int().nullable(),
  perTenantLimit: z.number().int(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  redemptions: z.number().int(),
  /** Pending charges (< 24 h) holding a use of the coupon. */
  holds: z.number().int(),
});
export type PlatformCoupon = z.infer<typeof platformCouponSchema>;
export const platformCouponListSchema = z.object({ items: z.array(platformCouponSchema) });
export type PlatformCouponList = z.infer<typeof platformCouponListSchema>;

export const platformCouponSaveRequestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9_-]{3,32}$/)),
    type: couponTypeSchema,
    value: z.number().positive().max(100000),
    plans: z.array(z.enum(["start", "pro"])).max(2).default([]),
    period: couponPeriodSchema.default("any"),
    maxRedemptions: z.number().int().min(1).nullable().default(null),
    perTenantLimit: z.number().int().min(1).max(1000).default(1),
    validFrom: z.string().datetime({ offset: true }).nullable().default(null),
    validUntil: z.string().datetime({ offset: true }).nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    const int = Number.isInteger(v.value);
    if (v.type === "percent" && (!int || v.value > 100)) ctx.addIssue({ code: "custom", path: ["value"], message: "percent must be an integer 1..100" });
    if (v.type === "free_days" && (!int || v.value > 365)) ctx.addIssue({ code: "custom", path: ["value"], message: "free_days must be an integer 1..365" });
    if (v.type === "fixed_usd" && Math.round(v.value * 100) !== v.value * 100) ctx.addIssue({ code: "custom", path: ["value"], message: "max 2 decimals" });
    if (v.validFrom && v.validUntil && Date.parse(v.validUntil) <= Date.parse(v.validFrom)) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "validUntil must be after validFrom" });
    }
  });
export type PlatformCouponSaveRequest = z.infer<typeof platformCouponSaveRequestSchema>;

export const platformCouponRedemptionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  chargeId: z.string().uuid(),
  plan: z.enum(["start", "pro"]),
  discountAmount: z.string(),
  freeDays: z.number().int(),
  priceAmount: z.string(),
  createdAt: z.string(),
});
export type PlatformCouponRedemption = z.infer<typeof platformCouponRedemptionSchema>;
export const platformCouponRedemptionListSchema = z.object({ items: z.array(platformCouponRedemptionSchema) });
export type PlatformCouponRedemptionList = z.infer<typeof platformCouponRedemptionListSchema>;
