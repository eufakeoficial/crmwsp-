import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  primaryKey,
  text,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aiActions } from "./ai-actions.js";
import { bytea } from "./channel-connections.js";
import { productVariants } from "./commerce.js";
import { contacts } from "./contacts.js";
import { conversations } from "./conversations.js";
import { knowledgeChunks } from "./knowledge.js";
import { opportunities } from "./sales.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const productKind = pgEnum("product_kind", ["physical", "service", "digital"]);
export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
export const productPriceSource = pgEnum("product_price_source", ["manual", "knowledge"]);
export const quoteStatus = pgEnum("quote_status", [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
]);
import { quoteCreatedByType } from "./document-enums.js";

export { quoteCreatedByType };

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sku: text("sku"),
    slug: text("slug"),
    kind: productKind("kind").notNull().default("physical"),
    status: productStatus("status").notNull().default("active"),
    category: text("category"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** External video link (e.g. YouTube). The app enforces https and never downloads it. */
    videoUrl: text("video_url"),
    /** Stock is tracked per variant only when true (physical goods). */
    trackStock: boolean("track_stock").notNull().default(true),
    name: text("name").notNull(),
    description: text("description"),
    unit: text("unit"),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** Basis points: 2100 = 21%. */
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    version: integer("version").notNull().default(1),
    priceSource: productPriceSource("price_source").notNull().default("manual"),
    knowledgeChunkId: uuid("knowledge_chunk_id"),
    /** Catalog synced from an external store (e.g. 'shopify'); both NULL for manual products. */
    externalSource: text("external_source"),
    externalId: text("external_id"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("products_tenant_slug_unique")
      .on(t.tenantId, t.slug)
      .where(sql`${t.slug} IS NOT NULL`),
    uniqueIndex("products_tenant_sku_active_unique")
      .on(t.tenantId, t.sku)
      .where(sql`${t.sku} IS NOT NULL AND ${t.isActive}`),
    foreignKey({
      name: "products_tenant_knowledge_chunk_fk",
      columns: [t.tenantId, t.knowledgeChunkId],
      foreignColumns: [knowledgeChunks.tenantId, knowledgeChunks.id],
    }).onDelete("set null"),
    uniqueIndex("products_tenant_external_unique")
      .on(t.tenantId, t.externalSource, t.externalId)
      .where(sql`${t.externalSource} IS NOT NULL`),
    check("products_external_pair_check", sql`(${t.externalSource} IS NULL) = (${t.externalId} IS NULL)`),
    check("products_price_check", sql`${t.priceMinor} >= 0`),
    check("products_tax_rate_check", sql`${t.taxRateBp} BETWEEN 0 AND 10000`),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    opportunityId: uuid("opportunity_id"),
    contactId: uuid("contact_id").notNull(),
    conversationId: uuid("conversation_id"),
    status: quoteStatus("status").notNull().default("draft"),
    currency: char("currency", { length: 3 }).notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull().default(sql`0`),
    discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(sql`0`),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull().default(sql`0`),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull().default(sql`0`),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    notes: text("notes"),
    terms: text("terms"),
    pdfStorageKey: text("pdf_storage_key"),
    approvalActionId: uuid("approval_action_id"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** Hash (not the token) of the signed acceptance link. */
    acceptTokenHash: bytea("accept_token_hash"),
    createdByType: quoteCreatedByType("created_by_type").notNull(),
    lockVersion: integer("lock_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quotes_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("quotes_tenant_number_unique").on(t.tenantId, t.number),
    index("quotes_tenant_contact_idx").on(t.tenantId, t.contactId),
    index("quotes_tenant_status_idx").on(t.tenantId, t.status),
    /** Public acceptance link lookup: sha256(secret), unique per tenant. */
    uniqueIndex("quotes_tenant_accept_token_hash_idx")
      .on(t.tenantId, t.acceptTokenHash)
      .where(sql`${t.acceptTokenHash} IS NOT NULL`),
    check("quotes_total_check", sql`${t.totalMinor} >= 0`),
    foreignKey({
      name: "quotes_tenant_opportunity_fk",
      columns: [t.tenantId, t.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
    }).onDelete("set null"),
    foreignKey({
      name: "quotes_tenant_contact_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    foreignKey({
      name: "quotes_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("set null"),
    foreignKey({
      name: "quotes_tenant_approval_action_fk",
      columns: [t.tenantId, t.approvalActionId],
      foreignColumns: [aiActions.tenantId, aiActions.id],
    }).onDelete("set null"),
  ],
);

export const quoteItems = pgTable(
  "quote_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").notNull(),
    position: integer("position").notNull(),
    productId: uuid("product_id"),
    productVersion: integer("product_version"),
    /** Exact variant of catalog lines (0016). Null on free lines and on quotes older than 0016. */
    variantId: uuid("variant_id"),
    knowledgeChunkId: uuid("knowledge_chunk_id"),
    description: text("description").notNull(),
    /** Quantity x 1000 (1.5 units = 1500). */
    quantityMilli: bigint("quantity_milli", { mode: "bigint" }).notNull(),
    unit: text("unit"),
    unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
    discountBp: integer("discount_bp").notNull().default(0),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    lineTotalMinor: bigint("line_total_minor", { mode: "bigint" }).notNull(),
  },
  (t) => [
    uniqueIndex("quote_items_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("quote_items_tenant_quote_position_unique").on(t.tenantId, t.quoteId, t.position),
    foreignKey({
      name: "quote_items_tenant_quote_fk",
      columns: [t.tenantId, t.quoteId],
      foreignColumns: [quotes.tenantId, quotes.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "quote_items_tenant_product_fk",
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }).onDelete("set null"),
    // ON DELETE SET NULL ("variant_id") is hand-written in 0016 (drizzle has no column list).
    foreignKey({
      name: "quote_items_tenant_variant_fk",
      columns: [t.tenantId, t.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
    }).onDelete("set null"),
    foreignKey({
      name: "quote_items_tenant_knowledge_chunk_fk",
      columns: [t.tenantId, t.knowledgeChunkId],
      foreignColumns: [knowledgeChunks.tenantId, knowledgeChunks.id],
    }).onDelete("set null"),
    check("quote_items_quantity_check", sql`${t.quantityMilli} > 0`),
    check("quote_items_unit_price_check", sql`${t.unitPriceMinor} >= 0`),
    check("quote_items_discount_check", sql`${t.discountBp} BETWEEN 0 AND 10000`),
    check("quote_items_tax_rate_check", sql`${t.taxRateBp} BETWEEN 0 AND 10000`),
  ],
);

/**
 * Per-tenant, per-kind, per-year counter behind `next_document_number(kind, year)`
 * (`next_quote_number(year)` is a wrapper). Composite natural key, no surrogate id.
 */
export const documentSequences = pgTable(
  "document_sequences",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.kind, t.year] }),
    check("document_sequences_kind_check", sql`${t.kind} IN ('quote', 'order')`),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Quote = typeof quotes.$inferSelect;
export type NewQuote = typeof quotes.$inferInsert;
export type QuoteItemRow = typeof quoteItems.$inferSelect;
export type NewQuoteItemRow = typeof quoteItems.$inferInsert;
export type QuoteStatus = (typeof quoteStatus.enumValues)[number];
