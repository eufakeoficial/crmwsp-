import { sql } from "drizzle-orm";
import { foreignKey, index, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { actionDecision } from "./agent-configs.js";
import { conversations } from "./conversations.js";
import { messages } from "./messages.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const aiActionStatus = pgEnum("ai_action_status", [
  "proposed",
  "pending_approval",
  "approved",
  "rejected",
  "executed",
  "failed",
]);
export const approvalDecision = pgEnum("approval_decision", ["approved", "rejected"]);

export interface AiCitation {
  chunkId: string;
  sourceId: string;
  sourceVersion: number;
}

/** Action proposed by the AI; the system decides and executes it (ADR 0003). */
export const aiActions = pgTable(
  "ai_actions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Composite FKs (tenant_id, x_id) below, so links stay within the tenant.
    // Migration 0012 uses ON DELETE SET NULL (x_id) to keep tenant_id intact.
    conversationId: uuid("conversation_id"),
    messageId: uuid("message_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    citations: jsonb("citations").$type<AiCitation[]>().notNull().default([]),
    confidence: numeric("confidence"),
    decision: actionDecision("decision").notNull(),
    decisionReason: text("decision_reason"),
    status: aiActionStatus("status").notNull().default("proposed"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => [
    // UNIQUE (tenant_id, id): target of the composite FK from action_approvals.
    uniqueIndex("ai_actions_tenant_id_id_idx").on(t.tenantId, t.id),
    index("ai_actions_tenant_conversation_idx").on(t.tenantId, t.conversationId),
    foreignKey({
      name: "ai_actions_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("set null"),
    foreignKey({
      name: "ai_actions_tenant_message_fk",
      columns: [t.tenantId, t.messageId],
      foreignColumns: [messages.tenantId, messages.id],
    }).onDelete("set null"),
  ],
);

/** Human decision on an AI action. Append-only for the app role. */
export const actionApprovals = pgTable(
  "action_approvals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Composite FK (tenant_id, action_id) below: same-tenant action only.
    actionId: uuid("action_id").notNull(),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.id),
    decision: approvalDecision("decision").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("action_approvals_tenant_id_id_idx").on(t.tenantId, t.id),
    index("action_approvals_action_id_idx").on(t.actionId),
    foreignKey({
      name: "action_approvals_tenant_action_fk",
      columns: [t.tenantId, t.actionId],
      foreignColumns: [aiActions.tenantId, aiActions.id],
    }).onDelete("cascade"),
  ],
);

export type AiAction = typeof aiActions.$inferSelect;
export type NewAiAction = typeof aiActions.$inferInsert;
export type AiActionStatus = (typeof aiActionStatus.enumValues)[number];
export type ActionApproval = typeof actionApprovals.$inferSelect;
export type NewActionApproval = typeof actionApprovals.$inferInsert;
export type ApprovalDecision = (typeof approvalDecision.enumValues)[number];
