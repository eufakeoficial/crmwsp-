import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Support tickets (migration 0068, ADR 0016). The RLS policy of support_messages also hides
// internal notes from the app role and only lets it insert public tenant_user messages; the app
// role can update only the tenant workflow columns of support_tickets (column grants).

export const supportTicketStatuses = ["open", "in_progress", "waiting_customer", "resolved"] as const;
export const supportTicketCategories = ["billing", "whatsapp", "ai", "bug", "other"] as const;
export const supportTicketPriorities = ["low", "normal", "high", "urgent"] as const;
export const supportAuthorTypes = ["tenant_user", "platform_admin", "email_contact"] as const;
/** 0075 (ADR 0020): email tickets; external ones have no tenant. */
export const supportChannels = ["app", "email"] as const;

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Null only for external email tickets (CHECK support_tickets_tenant_required). */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: supportChannels }).notNull().default("app"),
    contactEmail: text("contact_email"),
    contactName: text("contact_name"),
    subjectNorm: text("subject_norm"),
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
    check("support_tickets_channel_check", sql`${t.channel} IN ('app', 'email')`),
    check("support_tickets_tenant_required", sql`${t.tenantId} IS NOT NULL OR ${t.channel} = 'email'`),
    check("support_tickets_resolved_check", sql`(${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL)`),
  ],
);

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    authorType: text("author_type", { enum: supportAuthorTypes }).notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** Internal note between platform admins; never visible to the tenant (RLS). */
    internal: boolean("internal").notNull().default(false),
    fromEmail: text("from_email"),
    toEmails: text("to_emails").array().notNull().default(sql`'{}'`),
    emailMessageId: text("email_message_id"),
    resendEmailId: text("resend_email_id"),
    /** Sanitized HTML of a received email (ADR 0020). */
    html: text("html"),
    attachments: jsonb("attachments").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    autoReason: text("auto_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_messages_ticket_idx").on(t.tenantId, t.ticketId, t.createdAt),
    check("support_messages_author_type_check", sql`${t.authorType} IN ('tenant_user', 'platform_admin', 'email_contact')`),
    check(
      "support_messages_body_len",
      sql`char_length(${t.body}) BETWEEN 1 AND 5000 OR (${t.emailMessageId} IS NOT NULL AND char_length(${t.body}) BETWEEN 1 AND 200000)`,
    ),
    uniqueIndex("support_messages_resend_email_idx").on(t.resendEmailId).where(sql`${t.resendEmailId} IS NOT NULL`),
    index("support_messages_email_message_idx").on(t.emailMessageId).where(sql`${t.emailMessageId} IS NOT NULL`),
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
