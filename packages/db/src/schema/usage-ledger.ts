import { sql } from "drizzle-orm";
import { bigint, char, index, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const usageKind = pgEnum("usage_kind", [
  "llm_tokens",
  "embedding_tokens",
  "transcription_seconds",
  "wa_message",
  "storage",
  "psp_fee",
]);

/**
 * Consumption and cost ledger. Append-only for the app role. Monthly spend is
 * summed by the SQL function `tenant_monthly_spend(month)` (SECURITY INVOKER,
 * subject to RLS).
 */
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: usageKind("kind").notNull(),
    quantity: numeric("quantity").notNull(),
    unit: text("unit").notNull(),
    costMinor: bigint("cost_minor", { mode: "bigint" }).notNull().default(sql`0`),
    currency: char("currency", { length: 3 }).notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_ledger_tenant_id_id_idx").on(t.tenantId, t.id),
    index("usage_ledger_tenant_occurred_at_idx").on(t.tenantId, t.occurredAt),
  ],
);

export type UsageLedgerEntry = typeof usageLedger.$inferSelect;
export type NewUsageLedgerEntry = typeof usageLedger.$inferInsert;
export type UsageKind = (typeof usageKind.enumValues)[number];
