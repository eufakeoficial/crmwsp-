import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * Sales playbook of a tenant, one row per tenant: ethical sales guidance injected into the AI turn.
 * `config` holds stage guidance, the objection library, closing style and follow-up settings; it is
 * validated with `playbookConfigSchema` (@crmwsp/contracts) on write and re-validated on read.
 */
export const salesPlaybooks = pgTable(
  "sales_playbooks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_playbooks_tenant_unique").on(t.tenantId),
    index("sales_playbooks_tenant_id_id_idx").on(t.tenantId, t.id),
  ],
);

export type SalesPlaybook = typeof salesPlaybooks.$inferSelect;
export type NewSalesPlaybook = typeof salesPlaybooks.$inferInsert;
