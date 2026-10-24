import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Support tickets (migration 0068, ADR 0016). The RLS policy of support_messages also hides
// internal notes from the app role and only lets it insert public tenant_user messages; the app
// role can update only the tenant workflow columns of support_tickets (column grants).

export const supportTicketStatuses = ["open", "in_progress", "waiting_customer", "resolved"] as const;
export const supportTicketCategories = ["billing", "whatsapp", "ai", "bug", "other"] as const;
export const supportTicketPriorities = ["low", "normal", "high", "urgent"] as const;
export const supportAuthorTypes = ["tenant_user", "platform_admin"] as const;

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Human-friendly global number (#123). */
    number: integer("number").generatedAlwaysAsIdentity().notNull().unique("support_tickets_number_unique"),
    subject: text("subject").notNull(),
    category: text("category", { enum: supportTicketCategories }).notNull(),
    priority: text("priority", { enum: supportTicketPriorities }).notNull().default("normal"),
    status: text("status", { enum: supportTicketStatuses }).notNull().default("open"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Platform admin handling it; only the platform functions change it. */
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    tenantUnread: boolean("tenant_unread").notNull().default(false),
    adminUnread: boolean("admin_unread").notNull().default(true),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("support_tickets_tenant_id_id_idx").on(t.tenantId, t.id),
    index("support_tickets_tenant_last_idx").on(t.tenantId, t.lastMessageAt),
    index("support_tickets_status_last_idx").on(t.status, t.lastMessageAt),
    check("support_tickets_subject_len", sql`char_length(${t.subject}) BETWEEN 1 AND 160`),
    check("support_tickets_category_check", sql`${t.category} IN ('billing', 'whatsapp', 'ai', 'bug', 'other')`),
    check("support_tickets_priority_check", sql`${t.priority} IN ('low', 'normal', 'high', 'urgent')`),
    check("support_tickets_status_check", sql`${t.status} IN ('open', 'in_progress', 'waiting_customer', 'resolved')`),
    check("support_tickets_resolved_check", sql`(${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL)`),
  ],
);

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull(),
    authorType: text("author_type", { enum: supportAuthorTypes }).notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** Internal note between platform admins; never visible to the tenant (RLS). */
    internal: boolean("internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_messages_ticket_idx").on(t.tenantId, t.ticketId, t.createdAt),
    check("support_messages_author_type_check", sql`${t.authorType} IN ('tenant_user', 'platform_admin')`),
    check("support_messages_body_len", sql`char_length(${t.body}) BETWEEN 1 AND 5000`),
    check("support_messages_internal_admin_only", sql`NOT ${t.internal} OR ${t.authorType} = 'platform_admin'`),
    foreignKey({
      name: "support_messages_tenant_ticket_fk",
      columns: [t.tenantId, t.ticketId],
      foreignColumns: [supportTickets.tenantId, supportTickets.id],
    }).onDelete("cascade"),
  ],
);

/** Platform-level canned replies; no privileges for the app role (platform functions only). */
export const supportCannedResponses = pgTable(
  "support_canned_responses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    title: text("title").notNull(),
    body: text("body").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("support_canned_title_len", sql`char_length(${t.title}) BETWEEN 1 AND 120`),
    check("support_canned_body_len", sql`char_length(${t.body}) BETWEEN 1 AND 5000`),
  ],
);

export type SupportTicketRow = typeof supportTickets.$inferSelect;
export type SupportMessageRow = typeof supportMessages.$inferSelect;
