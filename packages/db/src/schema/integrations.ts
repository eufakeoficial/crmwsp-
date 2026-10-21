import { sql } from "drizzle-orm";
import { bigint, char, check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./channel-connections.js";
import { orders } from "./commerce.js";
import { contacts } from "./contacts.js";
import { tenants } from "./tenants.js";

export const commerceProviders = ["shopify", "hotmart", "kiwify", "eduzz", "gumroad", "payhip", "tiendanube", "woocommerce"] as const;
export type CommerceProviderName = (typeof commerceProviders)[number];
const providerList = sql.raw(commerceProviders.map((p) => `'${p}'`).join(", "));

/**
 * External store / infoproduct platform account of a tenant. Secrets only as ciphertext
 * (AAD = tenant + purpose). The webhook is authenticated by the opaque `webhook_token` in the URL
 * (resolves the tenant, via SECURITY DEFINER `resolve_commerce_webhook`) AND the provider's
 * signature / shared token, checked with the decrypted `webhook_secret`.
 */
export const commerceConnections = pgTable(
  "commerce_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: commerceProviders }).notNull(),
    webhookSecretEncrypted: bytea("webhook_secret_encrypted").notNull(),
    /** Shopify Admin API access token (catalog sync). */
    accessTokenEncrypted: bytea("access_token_encrypted"),
    secretHint: text("secret_hint"),
    /** Shopify `my-shop.myshopify.com`. */
    shopDomain: text("shop_domain"),
    /** Shopify shop currency, learned at catalog sync (product webhooks carry no currency). */
    shopCurrency: char("shop_currency", { length: 3 }),
    webhookToken: text("webhook_token").notNull().unique("commerce_connections_webhook_token_unique"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("commerce_connections_tenant_provider_unique").on(t.tenantId, t.provider),
    uniqueIndex("commerce_connections_tenant_id_id_idx").on(t.tenantId, t.id),
    check("commerce_connections_provider_check", sql`${t.provider} IN (${providerList})`),
    check("commerce_connections_status_check", sql`${t.status} IN ('active', 'disabled')`),
  ],
);

export const externalSaleStatuses = ["pending", "approved", "refunded"] as const;

/**
 * A sale that happened on an external platform. Recorded for metrics / notifications only: it
 * NEVER transitions a CRMWSP order. `order_id` is set only when the event was body-signed with a
 * confirmed scheme AND referenced an order of this tenant AND amount + currency matched it.
 */
export const externalSales = pgTable(
  "external_sales",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: commerceProviders }).notNull(),
    externalId: text("external_id").notNull(),
    status: text("status", { enum: externalSaleStatuses }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }),
    currency: char("currency", { length: 3 }),
    buyerEmail: text("buyer_email"),
    buyerPhoneE164: text("buyer_phone_e164"),
    buyerName: text("buyer_name"),
    productRef: text("product_ref"),
    productName: text("product_name"),
    contactId: uuid("contact_id"),
    orderId: uuid("order_id"),
    verification: text("verification", { enum: ["hmac_body", "shared_token"] }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("external_sales_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("external_sales_tenant_provider_external_unique").on(t.tenantId, t.provider, t.externalId),
    index("external_sales_tenant_contact_idx").on(t.tenantId, t.contactId),
    index("external_sales_tenant_occurred_idx").on(t.tenantId, t.occurredAt),
    check("external_sales_provider_check", sql`${t.provider} IN (${providerList})`),
    check("external_sales_status_check", sql`${t.status} IN ('pending', 'approved', 'refunded')`),
    check("external_sales_amount_check", sql`${t.amountMinor} IS NULL OR ${t.amountMinor} >= 0`),
    check("external_sales_order_needs_hmac_check", sql`${t.orderId} IS NULL OR ${t.verification} = 'hmac_body'`),
    foreignKey({
      name: "external_sales_tenant_contact_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }).onDelete("set null"),
    foreignKey({
      name: "external_sales_tenant_order_fk",
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }).onDelete("set null"),
  ],
);

/**
 * Verified commerce webhook deliveries, deduplicated per (tenant, provider, event id). Inserted
 * first (ON CONFLICT DO NOTHING) in the same transaction as the effect; `outcome` records it.
 */
export const commerceEvents = pgTable(
  "commerce_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: commerceProviders }).notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    externalSaleId: uuid("external_sale_id"),
    outcome: text("outcome").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("commerce_events_tenant_provider_event_unique").on(t.tenantId, t.provider, t.eventId),
    index("commerce_events_tenant_received_idx").on(t.tenantId, t.receivedAt),
  ],
);

export type CommerceConnection = typeof commerceConnections.$inferSelect;
export type ExternalSale = typeof externalSales.$inferSelect;
export type CommerceEvent = typeof commerceEvents.$inferSelect;
