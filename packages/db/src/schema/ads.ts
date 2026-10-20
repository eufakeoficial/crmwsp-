import { sql } from "drizzle-orm";
import { bigint, char, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./channel-connections.js";
import { orders } from "./commerce.js";
import { contacts } from "./contacts.js";
import { conversations } from "./conversations.js";
import { tenants } from "./tenants.js";

/**
 * First-touch Click-to-WhatsApp attribution: ONE row per contact, written by the inbound worker
 * from the first message that carried a Meta `referral` (later referrals never overwrite it).
 * Orders are attributed to the ad through `contact_id`.
 */
export const adAttributions = pgTable(
  "ad_attributions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    conversationId: uuid("conversation_id"),
    /** Meta ad id (`source_id`); null when only the click id came through. */
    sourceId: text("source_id"),
    sourceType: text("source_type"),
    sourceUrl: text("source_url"),
    headline: text("headline"),
    ctwaClid: text("ctwa_clid"),
    firstMessageExternalId: text("first_message_external_id"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_attributions_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("ad_attributions_tenant_contact_unique").on(t.tenantId, t.contactId),
    index("ad_attributions_tenant_source_idx").on(t.tenantId, t.sourceId),
    check("ad_attributions_identity_check", sql`${t.sourceId} IS NOT NULL OR ${t.ctwaClid} IS NOT NULL`),
    foreignKey({ name: "ad_attributions_tenant_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
    foreignKey({
      name: "ad_attributions_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("set null"),
  ],
);
export type AdAttribution = typeof adAttributions.$inferSelect;

/** Ad spend entered by the tenant (manual), one total per (ad id, currency). */
export const adSpend = pgTable(
  "ad_spend",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    label: text("label"),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_spend_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("ad_spend_tenant_source_currency_unique").on(t.tenantId, t.sourceId, t.currency),
    check("ad_spend_amount_check", sql`${t.amountMinor} >= 0`),
  ],
);
export type AdSpend = typeof adSpend.$inferSelect;

/**
 * Meta Conversions API destination of a tenant (BYOK). The access token only as ciphertext
 * (AAD = tenant + purpose); never returned nor logged.
 */
export const metaCapiConnections = pgTable(
  "meta_capi_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Pixel / dataset id. */
    datasetId: text("dataset_id").notNull(),
    accessTokenEncrypted: bytea("access_token_encrypted").notNull(),
    tokenHint: text("token_hint"),
    /** Meta Events Manager test code; when set every event is sent as a test event. */
    testEventCode: text("test_event_code"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("meta_capi_connections_tenant_unique").on(t.tenantId),
    check("meta_capi_connections_status_check", sql`${t.status} IN ('active', 'disabled')`),
    check("meta_capi_connections_dataset_check", sql`${t.datasetId} ~ '^[0-9]{5,32}$'`),
  ],
);
export type MetaCapiConnection = typeof metaCapiConnections.$inferSelect;

export const capiEventNames = ["Lead", "Purchase"] as const;
export const capiEventStatuses = ["pending", "sent", "dead"] as const;

/**
 * Sent-events log / outbox of the Conversions API. `event_id` (e.g. `lead:<attribution id>`,
 * `purchase:<order id>`) is unique per tenant, so an event is created and sent at most once;
 * Meta also dedupes by the same `event_id`.
 */
export const capiEvents = pgTable(
  "capi_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventName: text("event_name", { enum: capiEventNames }).notNull(),
    contactId: uuid("contact_id").notNull(),
    orderId: uuid("order_id"),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    status: text("status", { enum: capiEventStatuses }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    /** Sanitized error (status code / Meta error code); never the token nor the request. */
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("capi_events_tenant_event_unique").on(t.tenantId, t.eventId),
    index("capi_events_tenant_due_idx").on(t.tenantId, t.status, t.nextAttemptAt),
    check("capi_events_name_check", sql`${t.eventName} IN ('Lead', 'Purchase')`),
    check("capi_events_status_check", sql`${t.status} IN ('pending', 'sent', 'dead')`),
    check("capi_events_purchase_order_check", sql`${t.eventName} <> 'Purchase' OR ${t.orderId} IS NOT NULL`),
    foreignKey({ name: "capi_events_tenant_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
    foreignKey({ name: "capi_events_tenant_order_fk", columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete("cascade"),
  ],
);
export type CapiEvent = typeof capiEvents.$inferSelect;
