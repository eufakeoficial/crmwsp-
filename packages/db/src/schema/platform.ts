import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, date, index, inet, jsonb, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * SaaS platform backoffice (ADR 0011). None of these tables is reachable by the app role
 * (`crmwsp_app` has no privileges on them, 0052): every read/write goes through the
 * `platform_*` SECURITY DEFINER functions, which re-check `platform_admins` on each call.
 */

/** Platform operators. Granted only by the CLI script (migrator role); no API creates rows. */
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Singleton row (id = 1) with platform-wide settings. */
export const platformSettings = pgTable(
  "platform_settings",
  {
    id: smallint("id").primaryKey().default(1),
    /** When true, new signups start as `pending_approval`. Default off. */
    requireApproval: boolean("require_approval").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("platform_settings_singleton", sql`${t.id} = 1`)],
);

/** Append-only log of every platform-admin action (no FK on tenant_id: survives tenant deletion). */
export const platformAuditEvents = pgTable(
  "platform_audit_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    tenantId: uuid("tenant_id"),
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull().default({}),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("platform_audit_events_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const subscriptionPaymentMethods = ["transfer", "cash", "card_manual", "mercadopago", "stripe"] as const;

/** SaaS revenue recorded manually by a platform admin (not tenant orders/payments). */
export const subscriptionPayments = pgTable(
  "subscription_payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    method: text("method", { enum: subscriptionPaymentMethods }).notNull(),
    reference: text("reference"),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscription_payments_tenant_idx").on(t.tenantId, t.periodEnd),
    index("subscription_payments_created_idx").on(t.createdAt),
    check("subscription_payments_amount_check", sql`${t.amountMinor} > 0`),
    check("subscription_payments_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("subscription_payments_period_check", sql`${t.periodEnd} >= ${t.periodStart}`),
    check(
      "subscription_payments_method_check",
      sql`${t.method} IN ('transfer', 'cash', 'card_manual', 'mercadopago', 'stripe')`,
    ),
  ],
);

export type PlatformAuditEvent = typeof platformAuditEvents.$inferSelect;
export type SubscriptionPayment = typeof subscriptionPayments.$inferSelect;
