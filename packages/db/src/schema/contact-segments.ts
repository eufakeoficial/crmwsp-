import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/** Stored contact filter (validated by `contactFilterSchema` in @crmwsp/contracts). */
export interface StoredContactFilter {
  match: "all" | "any";
  conditions: { field: string; type: string; operator: string; value?: unknown }[];
}

/** Saved contact filters ("segments"); counts are computed live, never stored. */
export const contactSegments = pgTable(
  "contact_segments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filter: jsonb("filter").$type<StoredContactFilter>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_segments_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("contact_segments_tenant_name_unique").on(t.tenantId, t.name),
  ],
);

export type ContactSegmentRow = typeof contactSegments.$inferSelect;
