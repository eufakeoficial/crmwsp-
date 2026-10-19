import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("contacts_tenant_phone_unique").on(t.tenantId, t.phoneE164),
    index("contacts_tenant_id_id_idx").on(t.tenantId, t.id),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
