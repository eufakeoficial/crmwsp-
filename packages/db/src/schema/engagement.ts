import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { channelConnections } from "./channel-connections.js";
import { contacts } from "./contacts.js";
import { conversations } from "./conversations.js";
import { messages } from "./messages.js";
import { quotes } from "./quotes.js";
import { opportunities } from "./sales.js";
import { tenants } from "./tenants.js";

export const consentKind = pgEnum("consent_kind", ["marketing", "service", "follow_up"]);
export const consentStatus = pgEnum("consent_status", ["granted", "revoked"]);
export const templateCategory = pgEnum("template_category", ["marketing", "utility", "authentication"]);
export const templateStatus = pgEnum("template_status", ["approved", "pending", "rejected", "paused", "disabled"]);
export const followUpStatus = pgEnum("follow_up_status", ["suggested", "scheduled", "sent", "skipped", "cancelled"]);

export interface ConsentEvidence {
  messageId?: string;
  source: string;
  text?: string;
}

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    kind: consentKind("kind").notNull(),
    status: consentStatus("status").notNull(),
    evidence: jsonb("evidence").$type<ConsentEvidence>().notNull().default(sql`'{"source":"unknown"}'::jsonb`),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("consents_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("consents_tenant_contact_kind_unique").on(t.tenantId, t.contactId, t.kind),
    foreignKey({
      name: "consents_tenant_contact_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }).onDelete("cascade"),
  ],
);

export const messageTemplates = pgTable(
  "message_templates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: templateCategory("category").notNull(),
    status: templateStatus("status").notNull().default("pending"),
    body: text("body").notNull(),
    variables: jsonb("variables").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    externalId: text("external_id"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("message_templates_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("message_templates_tenant_channel_name_language_unique").on(
      t.tenantId,
      t.channelConnectionId,
      t.name,
      t.language,
    ),
    foreignKey({
      name: "message_templates_tenant_channel_connection_fk",
      columns: [t.tenantId, t.channelConnectionId],
      foreignColumns: [channelConnections.tenantId, channelConnections.id],
    }).onDelete("cascade"),
  ],
);

export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id"),
    conversationId: uuid("conversation_id").notNull(),
    quoteId: uuid("quote_id"),
    /** Human-readable explanation of why this follow-up exists. */
    reason: text("reason").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: followUpStatus("status").notNull().default("suggested"),
    requiresTemplate: boolean("requires_template").notNull().default(false),
    templateId: uuid("template_id"),
    consentCheckedAt: timestamp("consent_checked_at", { withTimezone: true }),
    skipReason: text("skip_reason"),
    sentMessageId: uuid("sent_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("follow_ups_tenant_id_id_idx").on(t.tenantId, t.id),
    index("follow_ups_tenant_status_scheduled_idx").on(t.tenantId, t.status, t.scheduledAt),
    foreignKey({
      name: "follow_ups_tenant_opportunity_fk",
      columns: [t.tenantId, t.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
    }).onDelete("set null"),
    foreignKey({
      name: "follow_ups_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "follow_ups_tenant_quote_fk",
      columns: [t.tenantId, t.quoteId],
      foreignColumns: [quotes.tenantId, quotes.id],
    }).onDelete("set null"),
    foreignKey({
      name: "follow_ups_tenant_template_fk",
      columns: [t.tenantId, t.templateId],
      foreignColumns: [messageTemplates.tenantId, messageTemplates.id],
    }).onDelete("set null"),
    foreignKey({
      name: "follow_ups_tenant_sent_message_fk",
      columns: [t.tenantId, t.sentMessageId],
      foreignColumns: [messages.tenantId, messages.id],
    }).onDelete("set null"),
  ],
);

export type Consent = typeof consents.$inferSelect;
export type NewConsent = typeof consents.$inferInsert;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
export type FollowUp = typeof followUps.$inferSelect;
export type NewFollowUp = typeof followUps.$inferInsert;
