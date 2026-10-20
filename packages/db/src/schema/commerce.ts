import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "./contacts.js";
import { conversations } from "./conversations.js";
import { quoteCreatedByType } from "./document-enums.js";
import { products, quotes } from "./quotes.js";
import { opportunities } from "./sales.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const productMediaKind = pgEnum("product_media_kind", ["image", "video_link", "document"]);
export const orderStatus = pgEnum("order_status", [
  "draft",
  "pending_payment",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);
export const orderFulfillment = pgEnum("order_fulfillment", ["shipping", "pickup", "digital", "service"]);
export const orderStockState = pgEnum("order_stock_state", ["none", "reserved", "committed", "released"]);
export const stockMovementReason = pgEnum("stock_movement_reason", [
  "order_reserved",
  "order_committed",
  "order_released",
  "manual_adjust",
  "import",
]);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    sku: text("sku"),
    /** e.g. {"talla":"M","color":"Negro"}. */
    options: jsonb("options").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    /** Normalized options (the app builds it); '' for the default variant. Unique per product. */
    optionKey: text("option_key").notNull().default(""),
    /** NULL: use the product price. */
    priceMinor: bigint("price_minor", { mode: "bigint" }),
    compareAtMinor: bigint("compare_at_minor", { mode: "bigint" }),
    stockOnHand: integer("stock_on_hand").notNull().default(0),
    stockReserved: integer("stock_reserved").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    position: integer("position").notNull().default(0),
    /** Synced variant id of the external store; NULL for manual variants. */
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("product_variants_tenant_id_id_idx").on(t.tenantId, t.id),
    // Target of the composite FK from product_media: the variant belongs to the product.
    unique("product_variants_tenant_product_id_unique").on(t.tenantId, t.productId, t.id),
    unique("product_variants_tenant_product_option_key_unique").on(t.tenantId, t.productId, t.optionKey),
    uniqueIndex("product_variants_tenant_sku_active_unique")
      .on(t.tenantId, t.sku)
      .where(sql`${t.sku} IS NOT NULL AND ${t.isActive}`),
    foreignKey({
      name: "product_variants_tenant_product_fk",
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }).onDelete("cascade"),
    uniqueIndex("product_variants_tenant_external_unique")
      .on(t.tenantId, t.externalSource, t.externalId)
      .where(sql`${t.externalSource} IS NOT NULL`),
    check("product_variants_external_pair_check", sql`(${t.externalSource} IS NULL) = (${t.externalId} IS NULL)`),
    check("product_variants_stock_on_hand_check", sql`${t.stockOnHand} >= 0`),
    check("product_variants_stock_reserved_check", sql`${t.stockReserved} >= 0`),
    check("product_variants_price_check", sql`${t.priceMinor} IS NULL OR ${t.priceMinor} >= 0`),
    check("product_variants_compare_at_check", sql`${t.compareAtMinor} IS NULL OR ${t.compareAtMinor} >= 0`),
  ],
);

export const productMedia = pgTable(
  "product_media",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id"),
    kind: productMediaKind("kind").notNull(),
    storageKey: text("storage_key"),
    url: text("url"),
    alt: text("alt"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("product_media_tenant_id_id_idx").on(t.tenantId, t.id),
    index("product_media_tenant_product_idx").on(t.tenantId, t.productId, t.position),
    foreignKey({
      name: "product_media_tenant_product_fk",
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }).onDelete("cascade"),
    // variant_id must belong to product_id (and tenant). SET NULL (variant_id) in 0013.
    foreignKey({
      name: "product_media_tenant_product_variant_fk",
      columns: [t.tenantId, t.productId, t.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.productId, productVariants.id],
    }).onDelete("set null"),
    check(
      "product_media_source_check",
      sql`(${t.kind} = 'video_link' AND ${t.url} IS NOT NULL AND ${t.storageKey} IS NULL)
        OR (${t.kind} IN ('image', 'document') AND ${t.storageKey} IS NOT NULL AND ${t.url} IS NULL)`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    contactId: uuid("contact_id").notNull(),
    conversationId: uuid("conversation_id"),
    opportunityId: uuid("opportunity_id"),
    quoteId: uuid("quote_id"),
    status: orderStatus("status").notNull().default("draft"),
    currency: char("currency", { length: 3 }).notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull().default(sql`0`),
    discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(sql`0`),
    shippingMinor: bigint("shipping_minor", { mode: "bigint" }).notNull().default(sql`0`),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull().default(sql`0`),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull().default(sql`0`),
    fulfillment: orderFulfillment("fulfillment").notNull(),
    shippingAddress: jsonb("shipping_address").$type<Record<string, unknown>>(),
    notes: text("notes"),
    /** Inventory state, driven only by reserve_stock / commit_stock / release_stock. */
    stockState: orderStockState("stock_state").notNull().default("none"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdByType: quoteCreatedByType("created_by_type").notNull(),
    lockVersion: integer("lock_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("orders_tenant_number_unique").on(t.tenantId, t.number),
    index("orders_tenant_status_created_idx").on(t.tenantId, t.status, t.createdAt.desc()),
    index("orders_tenant_contact_idx").on(t.tenantId, t.contactId),
    check("orders_total_check", sql`${t.totalMinor} >= 0`),
    foreignKey({
      name: "orders_tenant_contact_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    foreignKey({
      name: "orders_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("set null"),
    foreignKey({
      name: "orders_tenant_opportunity_fk",
      columns: [t.tenantId, t.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
    }).onDelete("set null"),
    foreignKey({
      name: "orders_tenant_quote_fk",
      columns: [t.tenantId, t.quoteId],
      foreignColumns: [quotes.tenantId, quotes.id],
    }).onDelete("set null"),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    variantId: uuid("variant_id"),
    productId: uuid("product_id"),
    description: text("description").notNull(),
    /** Snapshot of the chosen options (size, colour) at order time. */
    options: jsonb("options").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
    discountBp: integer("discount_bp").notNull().default(0),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    lineTotalMinor: bigint("line_total_minor", { mode: "bigint" }).notNull(),
  },
  (t) => [
    uniqueIndex("order_items_tenant_id_id_idx").on(t.tenantId, t.id),
    index("order_items_tenant_order_idx").on(t.tenantId, t.orderId),
    foreignKey({
      name: "order_items_tenant_order_fk",
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_items_tenant_variant_fk",
      columns: [t.tenantId, t.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
    }).onDelete("set null"),
    foreignKey({
      name: "order_items_tenant_product_fk",
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
    }).onDelete("set null"),
    check("order_items_quantity_check", sql`${t.quantity} > 0`),
    check("order_items_unit_price_check", sql`${t.unitPriceMinor} >= 0`),
    check("order_items_discount_check", sql`${t.discountBp} BETWEEN 0 AND 10000`),
    check("order_items_tax_rate_check", sql`${t.taxRateBp} BETWEEN 0 AND 10000`),
  ],
);

/**
 * Stock ledger. Append-only for the app role. `delta` is the signed change of the
 * quantity the reason affects: order_reserved +q (stock_reserved), order_released -q
 * (stock_reserved), order_committed -q (stock_on_hand), manual_adjust / import +-q (stock_on_hand).
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    delta: integer("delta").notNull(),
    reason: stockMovementReason("reason").notNull(),
    /** Polymorphic reference (order id for order_*), deliberately without FK. */
    refId: uuid("ref_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_movements_tenant_id_id_idx").on(t.tenantId, t.id),
    index("stock_movements_tenant_variant_idx").on(t.tenantId, t.variantId, t.createdAt),
    foreignKey({
      name: "stock_movements_tenant_variant_fk",
      columns: [t.tenantId, t.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
    }),
  ],
);

export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
export type ProductMedia = typeof productMedia.$inferSelect;
export type NewProductMedia = typeof productMedia.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type StockMovement = typeof stockMovements.$inferSelect;
export type NewStockMovement = typeof stockMovements.$inferInsert;
