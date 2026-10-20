import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aiMode } from "./conversations.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const actionDecision = pgEnum("ai_action_decision", ["auto", "approve", "deny"]);

/** Per action type: whether the AI may execute it, needs approval, or is denied (ADR 0003). */
export type AgentPolicies = Record<string, (typeof actionDecision.enumValues)[number]>;

/** Versioned agent configuration; exactly one active version per tenant. */
export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    systemPrompt: text("system_prompt").notNull().default(""),
    aiModeDefault: aiMode("ai_mode_default").notNull().default("assist"),
    confidenceThreshold: numeric("confidence_threshold", { precision: 3, scale: 2 }).notNull().default("0.75"),
    approvalThresholdMinor: bigint("approval_threshold_minor", { mode: "bigint" }),
    policies: jsonb("policies").$type<AgentPolicies>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_configs_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("agent_configs_tenant_version_unique").on(t.tenantId, t.version),
    uniqueIndex("agent_configs_tenant_active_unique").on(t.tenantId).where(sql`${t.isActive}`),
  ],
);

export type AgentConfig = typeof agentConfigs.$inferSelect;
export type NewAgentConfig = typeof agentConfigs.$inferInsert;
export type ActionDecision = (typeof actionDecision.enumValues)[number];
