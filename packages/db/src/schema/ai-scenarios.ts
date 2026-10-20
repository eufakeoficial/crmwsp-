import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Saved simulator scenarios (F6): customer messages plus expected outcomes, run as a regression
 * suite against the bot. Never linked to real conversations or contacts.
 */
export const aiScenarios = pgTable(
  "ai_scenarios",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    messages: jsonb("messages").$type<string[]>().notNull().default([]),
    /** Expectation codes, validated by `@crmwsp/contracts` (`aiScenarioExpectationSchema`). */
    expectations: jsonb("expectations").$type<string[]>().notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_scenarios_tenant_id_id_idx").on(t.tenantId, t.id)],
);

export type AiScenarioRow = typeof aiScenarios.$inferSelect;
