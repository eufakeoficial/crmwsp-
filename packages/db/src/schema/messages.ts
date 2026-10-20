import { sql } from "drizzle-orm";
import { bigint, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageType = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "location",
  "template",
  "interactive",
  "unsupported",
]);
export const messageStatus = pgEnum("message_status", ["received", "queued", "sent", "delivered", "read", "failed"]);
export const messageAuthor = pgEnum("message_author", ["contact", "user", "ai", "system"]);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirection("direction").notNull(),
    type: messageType("type").notNull(),
    body: text("body"),
    externalId: text("external_id"),
    status: messageStatus("status").notNull(),
    author: messageAuthor("author").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Client-generated idempotency key for outbound messages sent from the inbox. */
    clientMessageId: uuid("client_message_id"),
    error: jsonb("error").$type<Record<string, unknown>>(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_tenant_id_id_idx").on(t.tenantId, t.id),
    index("messages_tenant_conversation_created_idx").on(t.tenantId, t.conversationId, t.createdAt),
    uniqueIndex("messages_tenant_external_id_unique")
      .on(t.tenantId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    uniqueIndex("messages_tenant_client_message_id_unique")
      .on(t.tenantId, t.clientMessageId)
      .where(sql`${t.clientMessageId} IS NOT NULL`),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    externalMediaId: text("external_media_id"),
    transcript: text("transcript"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attachments_tenant_id_id_idx").on(t.tenantId, t.id),
    index("attachments_message_id_idx").on(t.messageId),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageDirection = (typeof messageDirection.enumValues)[number];
export type MessageType = (typeof messageType.enumValues)[number];
export type MessageStatus = (typeof messageStatus.enumValues)[number];
export type MessageAuthor = (typeof messageAuthor.enumValues)[number];
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
