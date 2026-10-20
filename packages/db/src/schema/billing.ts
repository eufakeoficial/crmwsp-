import { sql } from "drizzle-orm";
import { bigint, char, check, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** Keep in sync with `PLAN_IDS` in @crmwsp/billing. */
export const tenantPlanIds = ["start", "pro"] as const;

/**
 * Plan of a tenant (one row; missing row = default plan `start`). READ-ONLY for the app role
 * (0024): a tenant can never upgrade itself. Written by the platform (migrator/system role).
 * No subscription charging yet: no payment provider bills this plan.
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
