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
    }),
  ),
  /** `nowpayments` when crypto subscription charging is configured on the server (ADR 0013). */
  billingProvider: z.enum(["none", "nowpayments"]),
  subscription: z.object({
    /** `unbilled` = never paid through the platform (not restricted). */
    access: z.enum(["unbilled", "active", "grace", "restricted"]),
    /** Last paid day (`YYYY-MM-DD`, UTC), `null` when never paid. */
    paidUntil: z.string().nullable(),
    graceDays: z.number().int(),
  }),
});
export type BillingPlanResponse = z.infer<typeof billingPlanResponseSchema>;

export const subscriptionChargeStatusSchema = z.enum(["pending", "paid", "failed", "expired", "refunded"]);
export type SubscriptionChargeStatus = z.infer<typeof subscriptionChargeStatusSchema>;

/** `POST /billing/subscription/charges`: pay one 30-day period of `plan` in crypto. */
export const createSubscriptionChargeRequestSchema = z.object({ plan: z.enum(["start", "pro"]) }).strict();
export type CreateSubscriptionChargeRequest = z.infer<typeof createSubscriptionChargeRequestSchema>;

/** A NOWPayments invoice as shown to the tenant (address/amount to pay, QR payload, status). */
export const subscriptionChargeSchema = z.object({
  id: z.string().uuid(),
  plan: z.enum(["start", "pro"]),
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
  createdAt: z.string(),
});
export type SubscriptionChargeDto = z.infer<typeof subscriptionChargeSchema>;

export const subscriptionChargeListSchema = z.object({ items: z.array(subscriptionChargeSchema) });
export type SubscriptionChargeList = z.infer<typeof subscriptionChargeListSchema>;
