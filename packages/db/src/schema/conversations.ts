import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { channelConnections } from "./channel-connections.js";
import { contacts } from "./contacts.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const conversationStatus = pgEnum("conversation_status", ["open", "pending", "resolved"]);
export const aiMode = pgEnum("ai_mode", ["auto", "assist", "off"]);

/** Inbox folder (T23): `open` needs a human, `closed` is handled by automation or closed by hand. */
export const inboxStatuses = ["open", "closed"] as const;
export type InboxStatus = (typeof inboxStatuses)[number];

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channelConnectionId: uuid("channel_connection_id")
      .notNull()
      .references(() => channelConnections.id, { onDelete: "cascade" }),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    status: conversationStatus("status").notNull().default("open"),
    aiMode: aiMode("ai_mode").notNull().default("off"),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    /** Last time an agent marked the conversation as read; inbound messages after it are unread. */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    /** Inbox folder, independent of the lifecycle `status` (a closed chat keeps its thread). */
    inboxStatus: text("inbox_status", { enum: inboxStatuses }).notNull().default("open"),
    /** Set by "mark as unread"; cleared when the conversation is read. */
    markedUnread: boolean("marked_unread").notNull().default(false),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lockVersion: integer("lock_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_tenant_id_id_idx").on(t.tenantId, t.id),
    index("conversations_tenant_last_message_idx").on(t.tenantId, t.lastMessageAt.desc()),
    uniqueIndex("conversations_one_unresolved_unique")
      .on(t.tenantId, t.contactId, t.channelConnectionId)
      .where(sql`${t.status} <> 'resolved'`),
    index("conversations_tenant_inbox_status_idx").on(t.tenantId, t.inboxStatus, t.lastMessageAt.desc()),
    index("conversations_tenant_assigned_idx").on(t.tenantId, t.assignedUserId),
    check("conversations_inbox_status_check", sql`${t.inboxStatus} IN ('open', 'closed')`),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationStatus = (typeof conversationStatus.enumValues)[number];
export type AiMode = (typeof aiMode.enumValues)[number];
