import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea } from "./channel-connections.js";
import { tenants } from "./tenants.js";

export const llmProviders = ["openai", "openrouter", "deepseek", "custom"] as const;
export type LlmProvider = (typeof llmProviders)[number];

export interface LlmCapabilities {
  structuredOutput?: boolean;
  embeddings?: boolean;
  transcription?: boolean;
}

/**
 * OpenAI-compatible LLM connection of a tenant (ADR 0008). At most one active
 * per tenant. The API key is stored only as ciphertext; `api_key_hint` keeps
 * the last characters for display.
 *
 * `base_url` must be https in production: enforced by the application, not by
 * SQL, because the database cannot know NODE_ENV (dev may use http://localhost).
 */
export const llmConnections = pgTable(
  "llm_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: llmProviders }).notNull(),
    baseUrl: text("base_url").notNull(),
    apiKeyEncrypted: bytea("api_key_encrypted"),
    apiKeyHint: text("api_key_hint"),
    modelCheap: text("model_cheap").notNull(),
    modelStrong: text("model_strong"),
    capabilities: jsonb("capabilities").$type<LlmCapabilities>().notNull().default({}),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestOk: boolean("last_test_ok"),
    isActive: boolean("is_active").notNull().default(false),
    monthlyBudgetMinor: bigint("monthly_budget_minor", { mode: "bigint" }),
    budgetCurrency: char("budget_currency", { length: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("llm_connections_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("llm_connections_tenant_active_unique").on(t.tenantId).where(sql`${t.isActive}`),
    check("llm_connections_provider_check", sql`${t.provider} IN ('openai', 'openrouter', 'deepseek', 'custom')`),
    check(
      "llm_connections_budget_check",
      sql`${t.monthlyBudgetMinor} IS NULL OR (${t.monthlyBudgetMinor} >= 0 AND ${t.budgetCurrency} IS NOT NULL)`,
    ),
  ],
);

export type LlmConnection = typeof llmConnections.$inferSelect;
export type NewLlmConnection = typeof llmConnections.$inferInsert;
