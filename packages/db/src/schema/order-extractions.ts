import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { messages } from "./messages.js";
import { quotes } from "./quotes.js";
import { tenants } from "./tenants.js";

export const orderExtractionSources = ["audio", "image", "pdf"] as const;
export const orderExtractionStatuses = ["needs_confirmation", "ready", "applied", "discarded", "skipped", "failed"] as const;
export type OrderExtractionSource = (typeof orderExtractionSources)[number];
export type OrderExtractionStatus = (typeof orderExtractionStatuses)[number];

/**
 * One extracted line as stored (JSON: bigints as decimal strings). `match` is null for dudosos
 * without a chosen product; prices are copied from the catalog, never from the model.
 */
export interface StoredOrderLine {
  rawText: string;
  quantity: number | null;
  unit: string | null;
  productGuess: string;
  status: "matched" | "dudoso";
  reason: string | null;
  confidence: number;
  /** Set when a human fixed the line in the inbox. */
  editedBy?: string | null;
  match: {
    productId: string;
    variantId: string | null;
    productVersion: number;
    label: string;
    unit: string;
    unitPriceMinor: string;
    currency: string;
    taxRateBp: number;
  } | null;
  quantityMilli: string | null;
  alternatives: Array<{ productId: string; variantId: string | null; label: string; score: number }>;
}

/**
 * Orders detected from customer voice notes, photos or PDFs (F4). Each row links the source
 * message to the DRAFT quote built from the confident matches; a draft is never sent nor turned
 * into an order without a human going through the existing quote approval flow.
 */
export const orderExtractions = pgTable(
  "order_extractions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id").notNull(),
    attachmentId: uuid("attachment_id"),
    source: text("source", { enum: orderExtractionSources }).notNull(),
    status: text("status", { enum: orderExtractionStatuses }).notNull(),
    /** Sanitized reason for skipped/failed rows (e.g. `provider_without_vision`). */
    reason: text("reason"),
    items: jsonb("items").$type<StoredOrderLine[]>().notNull().default(sql`'[]'::jsonb`),
    notes: text("notes"),
    currency: text("currency"),
    quoteId: uuid("quote_id"),
    model: text("model"),
    lockVersion: integer("lock_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_extractions_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("order_extractions_tenant_message_unique").on(t.tenantId, t.messageId),
    index("order_extractions_tenant_conversation_idx").on(t.tenantId, t.conversationId, t.createdAt),
    check("order_extractions_source_check", sql`${t.source} IN ('audio', 'image', 'pdf')`),
    check(
      "order_extractions_status_check",
      sql`${t.status} IN ('needs_confirmation', 'ready', 'applied', 'discarded', 'skipped', 'failed')`,
    ),
    check("order_extractions_items_array_check", sql`jsonb_typeof(${t.items}) = 'array'`),
    foreignKey({
      name: "order_extractions_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_extractions_tenant_message_fk",
      columns: [t.tenantId, t.messageId],
      foreignColumns: [messages.tenantId, messages.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_extractions_tenant_quote_fk",
      columns: [t.tenantId, t.quoteId],
      foreignColumns: [quotes.tenantId, quotes.id],
    }).onDelete("set null"),
  ],
);

export type OrderExtraction = typeof orderExtractions.$inferSelect;
export type NewOrderExtraction = typeof orderExtractions.$inferInsert;
