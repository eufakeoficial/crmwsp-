import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/** Internal note of a conversation (T23): shown in the thread, never sent to the channel. */
export const conversationNotes = pgTable(
  "conversation_notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_notes_tenant_id_id_idx").on(t.tenantId, t.id),
    index("conversation_notes_conversation_idx").on(t.tenantId, t.conversationId, t.createdAt),
    foreignKey({
      name: "conversation_notes_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
  ],
);

/** Follow-up reminder of a user on a conversation; the worker tick notifies when due. */
export const conversationReminders = pgTable(
  "conversation_reminders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    note: text("note"),
    done: boolean("done").notNull().default(false),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_reminders_tenant_id_id_idx").on(t.tenantId, t.id),
    index("conversation_reminders_due_idx").on(t.tenantId, t.remindAt).where(sql`${t.done} = false`),
    index("conversation_reminders_conversation_idx").on(t.tenantId, t.conversationId),
    foreignKey({
      name: "conversation_reminders_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Tag catalog (T23): presentation (emoji, color) of the tag strings stored in `contacts.tags`.
 * The string stays the link, so contact filters keep matching on `contacts.tags`.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji"),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tags_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("tags_tenant_name_unique").on(t.tenantId, t.name),
    check("tags_color_check", sql`${t.color} IS NULL OR ${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

/** Saved replies agents insert from the composer (`/shortcut`). */
export const cannedResponses = pgTable(
  "canned_responses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    shortcut: text("shortcut"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("canned_responses_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("canned_responses_tenant_shortcut_unique").on(t.tenantId, t.shortcut).where(sql`${t.shortcut} IS NOT NULL`),
  ],
);

export type ConversationNote = typeof conversationNotes.$inferSelect;
export type ConversationReminder = typeof conversationReminders.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type CannedResponse = typeof cannedResponses.$inferSelect;
