import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, date, index, inet, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** Keep in sync with `PLAN_IDS` in @crmwsp/billing. */
export const tenantPlanIds = ["start", "pro"] as const;

/**
 * Plan of a tenant (one row; missing row = default plan `start`). READ-ONLY for the app role
 * (0024): a tenant can never upgrade itself. Written by the platform (migrator/system role).
 * A settled subscription charge (NOWPayments, ADR 0013) sets `plan` via `subscription_charge_apply`.
 */
export const tenantPlans = pgTable(
  "tenant_plans",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .unique("tenant_plans_tenant_unique"),
    plan: text("plan", { enum: tenantPlanIds }).notNull().default("start"),
    /** Optional per-tenant limit overrides set by a platform admin (`{ limitKey: number | null }`). */
    limitsOverride: jsonb("limits_override").$type<Record<string, number | null>>(),
    /** Trial lifecycle (migration 0068). `setupEndsAt` null = grandfathered tenant. */
    setupEndsAt: timestamp("setup_ends_at", { withTimezone: true }),
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    setupReminderSentAt: timestamp("setup_reminder_sent_at", { withTimezone: true }),
    /** First channel's number already used a free trial elsewhere (0069): payment required. */
    trialDeniedAt: timestamp("trial_denied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("tenant_plans_plan_check", sql`${t.plan} IN ('start', 'pro')`)],
);

/**
 * Monthly usage counters for the monthly plan limits (`ai_messages`, `broadcast_sends`).
 * `period` is `YYYY-MM` in the tenant time zone. Incremented with an upsert; never deleted by
 * the app role.
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    period: char("period", { length: 7 }).notNull(),
    limitKey: text("limit_key", { enum: ["ai_messages", "broadcast_sends"] }).notNull(),
    used: bigint("used", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("usage_counters_tenant_period_key_unique").on(t.tenantId, t.period, t.limitKey),
    check("usage_counters_key_check", sql`${t.limitKey} IN ('ai_messages', 'broadcast_sends')`),
    check("usage_counters_used_check", sql`${t.used} >= 0`),
    check("usage_counters_period_check", sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

export type TenantPlan = typeof tenantPlans.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;

export const subscriptionChargeStatuses = ["pending", "paid", "failed", "expired", "refunded"] as const;

/**
 * SaaS subscription charges paid by the tenant to CRMWSP through NOWPayments (crypto, ADR 0013).
 * One row per invoice attempt; `id` is sent as NOWPayments `order_id`. The app role can only
 * SELECT its own rows (0063); every write goes through SECURITY DEFINER functions:
 * `subscription_charge_create` / `subscription_charge_attach` (API) and
 * `subscription_charge_apply` (worker settlement: atomic pending → paid + 30-day period in
 * `subscription_payments`, in the same transaction). `paid` requires `verified_by`.
 */
export const subscriptionCharges = pgTable(
  "subscription_charges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plan: text("plan", { enum: tenantPlanIds }).notNull(),
    provider: text("provider", { enum: ["nowpayments"] }).notNull().default("nowpayments"),
    priceAmount: numeric("price_amount", { precision: 12, scale: 2 }).notNull(),
    priceCurrency: text("price_currency").notNull(),
    payCurrency: text("pay_currency").notNull(),
    payAmount: numeric("pay_amount", { precision: 38, scale: 18 }),
    payAddress: text("pay_address"),
    providerPaymentId: text("provider_payment_id"),
    providerStatus: text("provider_status"),
    actuallyPaid: numeric("actually_paid", { precision: 38, scale: 18 }),
    payinHash: text("payin_hash"),
    status: text("status", { enum: subscriptionChargeStatuses }).notNull().default("pending"),
    /** `coupon`: free period granted without a provider payment (price 0, ADR 0017). */
    verifiedBy: text("verified_by", { enum: ["webhook", "reconciliation", "coupon"] }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    /** Days granted when settled: 30 (monthly) or 365 (annual, migration 0067). */
    periodDays: integer("period_days").notNull().default(30),
    /** ADR 0017: price_amount (final) = list_price_amount - discount_amount. */
    listPriceAmount: numeric("list_price_amount", { precision: 12, scale: 2 }),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "restrict" }),
    couponCode: text("coupon_code"),
    /** Referral credits (20% each) consumed by this charge (migration 0072). */
    referralCredits: integer("referral_credits").notNull().default(0),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("subscription_charges_provider_payment_unique").on(t.providerPaymentId),
    // One on-chain deposit can never settle two charges.
    unique("subscription_charges_payin_hash_unique").on(t.payinHash),
    index("subscription_charges_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("subscription_charges_status_created_idx").on(t.status, t.createdAt),
    check("subscription_charges_plan_check", sql`${t.plan} IN ('start', 'pro')`),
    check("subscription_charges_provider_check", sql`${t.provider} IN ('nowpayments')`),
    check("subscription_charges_price_check", sql`${t.priceAmount} > 0 OR (${t.priceAmount} = 0 AND ${t.verifiedBy} = 'coupon')`),
    check(
      "subscription_charges_period_days_check",
      sql`${t.periodDays} IN (30, 365) OR (${t.verifiedBy} = 'coupon' AND ${t.periodDays} BETWEEN 1 AND 365)`,
    ),
    check("subscription_charges_status_check", sql`${t.status} IN ('pending', 'paid', 'failed', 'expired', 'refunded')`),
    check("subscription_charges_verified_by_check", sql`${t.verifiedBy} IS NULL OR ${t.verifiedBy} IN ('webhook', 'reconciliation', 'coupon')`),
    check(
      "subscription_charges_paid_check",
      sql`${t.status} <> 'paid' OR (${t.verifiedBy} IS NOT NULL AND ${t.paidAt} IS NOT NULL AND ${t.periodEnd} IS NOT NULL)`,
    ),
  ],
);

export type SubscriptionCharge = typeof subscriptionCharges.$inferSelect;

/**
 * One free trial per phone number / WABA for life (0069, ADR 0015). PLATFORM-LEVEL table: no
 * tenant_id scoping, RLS forced with no policy and no app-role privilege; only SECURITY DEFINER
 * functions read or write it. `identityHash` = HMAC-SHA256 hex with TRIAL_IDENTITY_SECRET.
 */
export const trialClaims = pgTable(
  "trial_claims",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    identityType: text("identity_type", { enum: ["phone", "waba"] }).notNull(),
    identityHash: text("identity_hash").notNull(),
    firstTenantId: uuid("first_tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("trial_claims_identity_unique").on(t.identityType, t.identityHash)],
);

/** Signup signals for the platform "posible multicuenta" flag (0069). Platform-level like trial_claims. */
export const tenantSignupSignals = pgTable("tenant_signup_signals", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  signupIp: inet("signup_ip"),
  emailNormalized: text("email_normalized"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Platform-level subscription coupons (migration 0071, ADR 0017). Not tenant scoped: the app role
 * has no privileges; tenants reach it only through SECURITY DEFINER functions.
 */
export const couponTypes = ["percent", "fixed_usd", "free_days"] as const;
export const coupons = pgTable("coupons", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique("coupons_code_unique"),
  type: text("type", { enum: couponTypes }).notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),
  plans: text("plans").array().notNull().default(sql`'{}'::text[]`),
  period: text("period", { enum: ["monthly", "annual", "any"] }).notNull().default("any"),
  maxRedemptions: integer("max_redemptions"),
  perTenantLimit: integer("per_tenant_limit").notNull().default(1),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Settled coupon uses, tenant scoped (RLS select own tenant; writes only via 0071 functions). */
export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "restrict" }),
    chargeId: uuid("charge_id")
      .notNull()
      .unique("coupon_redemptions_charge_unique")
      .references(() => subscriptionCharges.id, { onDelete: "cascade" }),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    freeDays: integer("free_days").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("coupon_redemptions_tenant_idx").on(t.tenantId, t.createdAt)],
);
export type Coupon = typeof coupons.$inferSelect;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
