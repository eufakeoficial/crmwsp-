import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { orders } from "./commerce.js";
import { conversations } from "./conversations.js";
import { messages } from "./messages.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const notificationKinds = [
  "order_confirmed",
  "order_paid",
  "handoff",
  "approval_requested",
  "payment_review",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export const notificationWhatsappStatuses = ["pending", "sent", "skipped", "not_configured"] as const;
export type NotificationWhatsappStatus = (typeof notificationWhatsappStatuses)[number];

/**
 * Team notification of a tenant (order confirmed/paid, handoff, approval requested, receipt to
 * review). Producers insert the row inside the transaction of the business change (dedupe by
 * `dedupe_key`); the worker notification tick publishes it over SSE and, when the tenant set an
 * owner phone, sends it by WhatsApp (`whatsapp_status`). `dispatched_at` marks the tick pass.
 * Read state is per user in `notification_reads`.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: notificationKinds }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    entity: text("entity"),
    entityId: uuid("entity_id"),
    conversationId: uuid("conversation_id"),
    dedupeKey: text("dedupe_key").notNull(),
    whatsappStatus: text("whatsapp_status", { enum: notificationWhatsappStatuses }).notNull().default("pending"),
    whatsappSkipReason: text("whatsapp_skip_reason"),
    whatsappMessageId: uuid("whatsapp_message_id"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("notifications_tenant_dedupe_unique").on(t.tenantId, t.dedupeKey),
    index("notifications_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("notifications_undispatched_idx").on(t.tenantId).where(sql`${t.dispatchedAt} IS NULL`),
    check(
      "notifications_kind_check",
      sql`${t.kind} IN ('order_confirmed', 'order_paid', 'handoff', 'approval_requested', 'payment_review')`,
    ),
    check("notifications_whatsapp_status_check", sql`${t.whatsappStatus} IN ('pending', 'sent', 'skipped', 'not_configured')`),
  ],
);

/** Per-user read marker of a notification (absent row = unread). */
export const notificationReads = pgTable(
  "notification_reads",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    notificationId: uuid("notification_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "notification_reads_pk", columns: [t.notificationId, t.userId] }),
    index("notification_reads_tenant_user_idx").on(t.tenantId, t.userId),
    foreignKey({
      name: "notification_reads_tenant_notification_fk",
      columns: [t.tenantId, t.notificationId],
      foreignColumns: [notifications.tenantId, notifications.id],
    }).onDelete("cascade"),
  ],
);

export const paymentReviewStatuses = ["pending", "approved", "rejected"] as const;
export type PaymentReviewStatus = (typeof paymentReviewStatuses)[number];
export const paymentReviewExtractions = ["extracted", "unsupported", "failed"] as const;
export type PaymentReviewExtraction = (typeof paymentReviewExtractions)[number];

/**
 * A customer-sent payment receipt (image) awaiting human verification. The AI only EXTRACTS
 * fields (amount/currency/date/reference + confidence); it never changes the order. Approval by a
 * human runs the manual mark-paid path (audited with the reviewer and this review id).
 */
export const paymentReviews = pgTable(
  "payment_reviews",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id"),
    status: text("status", { enum: paymentReviewStatuses }).notNull().default("pending"),
    extraction: text("extraction", { enum: paymentReviewExtractions }).notNull(),
    extractedAmountMinor: bigint("extracted_amount_minor", { mode: "bigint" }),
    extractedCurrency: char("extracted_currency", { length: 3 }),
    extractedDate: text("extracted_date"),
    extractedReference: text("extracted_reference"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    model: text("model"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_reviews_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("payment_reviews_tenant_message_unique").on(t.tenantId, t.messageId),
    index("payment_reviews_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
    check("payment_reviews_status_check", sql`${t.status} IN ('pending', 'approved', 'rejected')`),
    check("payment_reviews_extraction_check", sql`${t.extraction} IN ('extracted', 'unsupported', 'failed')`),
    check("payment_reviews_confidence_check", sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`),
    check(
      "payment_reviews_reviewed_check",
      sql`${t.status} = 'pending' OR (${t.reviewedAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: "payment_reviews_tenant_order_fk",
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }).onDelete("cascade"),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type PaymentReview = typeof paymentReviews.$inferSelect;
