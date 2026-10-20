import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164").notNull(),
    name: text("name"),
    extracted: jsonb("extracted").$type<Record<string, unknown>>().notNull().default({}),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** How the contact entered the book; `ad` is derived from ad_attributions, not stored. */
    source: text("source", { enum: ["organic", "api", "import"] }).notNull().default("organic"),
    /** AI turns and follow-ups skip the contact until this instant (T23). */
    automationsPausedUntil: timestamp("automations_paused_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("contacts_tenant_phone_unique").on(t.tenantId, t.phoneE164),
    uniqueIndex("contacts_tenant_id_id_idx").on(t.tenantId, t.id),
    check("contacts_source_check", sql`${t.source} IN ('organic', 'api', 'import')`),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
