import { sql } from "drizzle-orm";
import { foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { channelConnections } from "./channel-connections.js";
import { contacts } from "./contacts.js";
import { messageTemplates } from "./engagement.js";
import { messages } from "./messages.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const broadcastStatus = pgEnum("broadcast_status", ["draft", "scheduled", "sending", "completed", "cancelled"]);
export const broadcastRecipientStatus = pgEnum("broadcast_recipient_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "skipped",
]);

/** Audience filter over contacts (stored as-is; see @crmwsp/domain broadcasts). */
export interface BroadcastAudience {
  /** Contacts must have ALL of these tags (empty = every contact). */
  tags: string[];
  /** Contacts with ANY of these tags are excluded. */
  excludeTags: string[];
  /** Optional saved segment (contact_segments.id) the contacts must also match. */
  segmentId?: string | undefined;
}

/** One entry per template variable, in order: where the value comes from. */
export type BroadcastVariableSource =
  | { source: "contact_name"; fallback?: string | undefined }
  | { source: "contact_phone" }
  | { source: "contact_field"; key: string; fallback?: string | undefined }
  | { source: "static"; value: string };

export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    templateId: uuid("template_id").notNull(),
    variableMapping: jsonb("variable_mapping").$type<BroadcastVariableSource[]>().notNull().default(sql`'[]'::jsonb`),
    audience: jsonb("audience").$type<BroadcastAudience>().notNull().default(sql`'{"tags":[],"excludeTags":[]}'::jsonb`),
    status: broadcastStatus("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** Sends booked against the plan (`broadcast_sends`) when the campaign was scheduled. */
    reservedSends: integer("reserved_sends").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("broadcasts_tenant_id_id_idx").on(t.tenantId, t.id),
    index("broadcasts_tenant_status_scheduled_idx").on(t.tenantId, t.status, t.scheduledAt),
    foreignKey({
      name: "broadcasts_tenant_channel_connection_fk",
      columns: [t.tenantId, t.channelConnectionId],
      foreignColumns: [channelConnections.tenantId, channelConnections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "broadcasts_tenant_template_fk",
      columns: [t.tenantId, t.templateId],
      foreignColumns: [messageTemplates.tenantId, messageTemplates.id],
    }).onDelete("cascade"),
  ],
);

export const broadcastRecipients = pgTable(
  "broadcast_recipients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    broadcastId: uuid("broadcast_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    phoneE164: text("phone_e164").notNull(),
    /** Template params resolved from the variable mapping when the audience was frozen. */
    params: jsonb("params").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: broadcastRecipientStatus("status").notNull().default("pending"),
    /** Outbound message created for this recipient (set once: idempotency per campaign+contact). */
    messageId: uuid("message_id"),
    error: jsonb("error").$type<Record<string, unknown>>(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("broadcast_recipients_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("broadcast_recipients_broadcast_contact_unique").on(t.tenantId, t.broadcastId, t.contactId),
    unique("broadcast_recipients_broadcast_phone_unique").on(t.tenantId, t.broadcastId, t.phoneE164),
    index("broadcast_recipients_tenant_broadcast_status_idx").on(t.tenantId, t.broadcastId, t.status),
    uniqueIndex("broadcast_recipients_tenant_message_unique")
      .on(t.tenantId, t.messageId)
      .where(sql`${t.messageId} IS NOT NULL`),
    foreignKey({
      name: "broadcast_recipients_tenant_broadcast_fk",
      columns: [t.tenantId, t.broadcastId],
      foreignColumns: [broadcasts.tenantId, broadcasts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "broadcast_recipients_tenant_contact_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "broadcast_recipients_tenant_message_fk",
      columns: [t.tenantId, t.messageId],
      foreignColumns: [messages.tenantId, messages.id],
    }).onDelete("set null"),
  ],
);

export type Broadcast = typeof broadcasts.$inferSelect;
export type NewBroadcast = typeof broadcasts.$inferInsert;
export type BroadcastRecipient = typeof broadcastRecipients.$inferSelect;
export type BroadcastStatus = (typeof broadcastStatus.enumValues)[number];
export type BroadcastRecipientStatus = (typeof broadcastRecipientStatus.enumValues)[number];
