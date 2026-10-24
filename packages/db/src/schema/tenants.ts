import { sql } from "drizzle-orm";
import { char, check, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Lifecycle of a tenant (ADR 0011). Only `active` tenants can use the panel API, channels and AI. */
export const tenantStatuses = ["active", "pending_approval", "rejected", "suspended"] as const;
export type TenantStatus = (typeof tenantStatuses)[number];

/**
 * Tenant (customer company). Protected by RLS: a session only sees the row
 * whose id equals `app.tenant_id` (see drizzle/0001_rls_identity.sql).
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    plan: text("plan").notNull().default("business"),
    status: text("status", { enum: tenantStatuses }).notNull().default("active"),
    /** Reason of the last reject/suspend (shown to the tenant owner). */
    statusReason: text("status_reason"),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    timezone: text("timezone").notNull().default("Europe/Madrid"),
    /** Business category key (business_categories, 0077); null for tenants created before T1. */
    businessCategory: text("business_category"),
    businessCategoryDetail: text("business_category_detail"),
    /** Category review (0077): only SECURITY DEFINER functions may change these columns. */
    categoryReviewStatus: text("category_review_status", { enum: ["none", "pending", "approved", "rejected"] }).notNull().default("none"),
    categoryReviewReason: text("category_review_reason"),
    businessCategorySetAt: timestamp("business_category_set_at", { withTimezone: true }),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "tenants_status_check",
      sql`${t.status} IN ('active', 'pending_approval', 'rejected', 'suspended')`,
    ),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
