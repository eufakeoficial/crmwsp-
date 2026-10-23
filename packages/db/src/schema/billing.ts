import { sql } from "drizzle-orm";
import { bigint, char, check, date, index, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
    verifiedBy: text("verified_by", { enum: ["webhook", "reconciliation"] }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
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
    check("subscription_charges_price_check", sql`${t.priceAmount} > 0`),
    check("subscription_charges_status_check", sql`${t.status} IN ('pending', 'paid', 'failed', 'expired', 'refunded')`),
    check("subscription_charges_verified_by_check", sql`${t.verifiedBy} IS NULL OR ${t.verifiedBy} IN ('webhook', 'reconciliation')`),
    check(
      "subscription_charges_paid_check",
      sql`${t.status} <> 'paid' OR (${t.verifiedBy} IS NOT NULL AND ${t.paidAt} IS NOT NULL AND ${t.periodEnd} IS NOT NULL)`,
    ),
  ],
);

export type SubscriptionCharge = typeof subscriptionCharges.$inferSelect;
