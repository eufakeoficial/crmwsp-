import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { channelConnections } from "./channel-connections";
import { contacts } from "./contacts";
import { tenants } from "./tenants";
import { users } from "./users";

export const conversationStatus = pgEnum("conversation_status", ["open", "pending", "resolved"]);
export const aiMode = pgEnum("ai_mode", ["auto", "assist", "off"]);

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
    lockVersion: integer("lock_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_tenant_id_id_idx").on(t.tenantId, t.id),
    index("conversations_tenant_last_message_idx").on(t.tenantId, t.lastMessageAt.desc()),
    uniqueIndex("conversations_one_unresolved_unique")
      .on(t.tenantId, t.contactId, t.channelConnectionId)
      .where(sql`${t.status} <> 'resolved'`),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationStatus = (typeof conversationStatus.enumValues)[number];
export type AiMode = (typeof aiMode.enumValues)[number];
