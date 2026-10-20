import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { aiActions } from "./ai-actions.js";
import { contacts } from "./contacts.js";
import { conversations } from "./conversations.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Every FK to a table with tenant_id is composite (tenant_id, x_id) -> parent(tenant_id, id)
// (ADR 0002). Nullable links use ON DELETE SET NULL (x_id) in migration 0013 so
// tenant_id (NOT NULL) is never nulled; drizzle-kit cannot express that column list.

export const pipelineStageKind = pgEnum("pipeline_stage_kind", ["open", "won", "lost"]);
export const opportunitySource = pgEnum("opportunity_source", ["whatsapp", "manual", "ai"]);
export const actorType = pgEnum("stage_changed_by_type", ["user", "ai", "system"]);
export const taskStatus = pgEnum("task_status", ["open", "done", "cancelled"]);
export const taskOrigin = pgEnum("task_origin", ["manual", "ai", "automation"]);

export const pipelines = pgTable(
  "pipelines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pipelines_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("pipelines_tenant_default_unique")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
  ],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    kind: pipelineStageKind("kind").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pipeline_stages_tenant_id_id_idx").on(t.tenantId, t.id),
    // Target of the composite FK from opportunities: the stage belongs to the pipeline.
    unique("pipeline_stages_tenant_pipeline_id_unique").on(t.tenantId, t.pipelineId, t.id),
    unique("pipeline_stages_tenant_pipeline_key_unique").on(t.tenantId, t.pipelineId, t.key),
    // DEFERRABLE (hand-edited in 0013) so positions can be swapped inside one transaction.
    unique("pipeline_stages_tenant_pipeline_position_unique").on(t.tenantId, t.pipelineId, t.position),
    foreignKey({
      name: "pipeline_stages_tenant_pipeline_fk",
      columns: [t.tenantId, t.pipelineId],
      foreignColumns: [pipelines.tenantId, pipelines.id],
    }).onDelete("cascade"),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    conversationId: uuid("conversation_id"),
    pipelineId: uuid("pipeline_id").notNull(),
    stageId: uuid("stage_id").notNull(),
    title: text("title").notNull(),
    valueMinor: bigint("value_minor", { mode: "bigint" }),
    currency: char("currency", { length: 3 }).notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    source: opportunitySource("source").notNull().default("manual"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    wonAt: timestamp("won_at", { withTimezone: true }),
    lostAt: timestamp("lost_at", { withTimezone: true }),
    lockVersion: integer("lock_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("opportunities_tenant_id_id_idx").on(t.tenantId, t.id),
    index("opportunities_tenant_stage_updated_idx").on(t.tenantId, t.stageId, t.updatedAt.desc()),
    index("opportunities_tenant_contact_idx").on(t.tenantId, t.contactId),
    foreignKey({
      name: "opportunities_tenant_contact_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "opportunities_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("set null"),
    foreignKey({
      name: "opportunities_tenant_pipeline_fk",
      columns: [t.tenantId, t.pipelineId],
      foreignColumns: [pipelines.tenantId, pipelines.id],
    }),
    // The stage must belong to the pipeline (and tenant).
    foreignKey({
      name: "opportunities_tenant_pipeline_stage_fk",
      columns: [t.tenantId, t.pipelineId, t.stageId],
      foreignColumns: [pipelineStages.tenantId, pipelineStages.pipelineId, pipelineStages.id],
    }),
  ],
);

/** Stage change audit. Append-only for the app role. */
export const opportunityStageHistory = pgTable(
  "opportunity_stage_history",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull(),
    fromStageId: uuid("from_stage_id"),
    toStageId: uuid("to_stage_id").notNull(),
    changedByType: actorType("changed_by_type").notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("opportunity_stage_history_tenant_id_id_idx").on(t.tenantId, t.id),
    index("opportunity_stage_history_tenant_opportunity_idx").on(t.tenantId, t.opportunityId, t.createdAt),
    foreignKey({
      name: "opportunity_stage_history_tenant_opportunity_fk",
      columns: [t.tenantId, t.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "opportunity_stage_history_tenant_from_stage_fk",
      columns: [t.tenantId, t.fromStageId],
      foreignColumns: [pipelineStages.tenantId, pipelineStages.id],
    }),
    foreignKey({
      name: "opportunity_stage_history_tenant_to_stage_fk",
      columns: [t.tenantId, t.toStageId],
      foreignColumns: [pipelineStages.tenantId, pipelineStages.id],
    }),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    status: taskStatus("status").notNull().default("open"),
    origin: taskOrigin("origin").notNull().default("manual"),
    opportunityId: uuid("opportunity_id"),
    conversationId: uuid("conversation_id"),
    aiActionId: uuid("ai_action_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_tenant_id_id_idx").on(t.tenantId, t.id),
    index("tasks_tenant_status_due_idx").on(t.tenantId, t.status, t.dueAt),
    foreignKey({
      name: "tasks_tenant_opportunity_fk",
      columns: [t.tenantId, t.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
    }).onDelete("set null"),
    foreignKey({
      name: "tasks_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("set null"),
    foreignKey({
      name: "tasks_tenant_ai_action_fk",
      columns: [t.tenantId, t.aiActionId],
      foreignColumns: [aiActions.tenantId, aiActions.id],
    }).onDelete("set null"),
  ],
);

export type Pipeline = typeof pipelines.$inferSelect;
export type NewPipeline = typeof pipelines.$inferInsert;
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type NewPipelineStage = typeof pipelineStages.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type OpportunityStageHistoryEntry = typeof opportunityStageHistory.$inferSelect;
export type NewOpportunityStageHistoryEntry = typeof opportunityStageHistory.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
