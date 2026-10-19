import { sql } from "drizzle-orm";
import { char, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Tenant (customer company). Protected by RLS: a session only sees the row
 * whose id equals `app.tenant_id` (see drizzle/0001_rls_identity.sql).
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("business"),
  status: text("status").notNull().default("active"),
  currency: char("currency", { length: 3 }).notNull().default("EUR"),
  timezone: text("timezone").notNull().default("Europe/Madrid"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
