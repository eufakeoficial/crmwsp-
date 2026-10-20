import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./channel-connections.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * Public API key of a tenant. Only the SHA-256 of the key is stored; `prefix` (first chars of the
 * key, not secret) identifies it in the UI. Resolved without tenant context only through the
 * SECURITY DEFINER `resolve_api_key(hash)` (0026).
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: bytea("key_hash").notNull(),
    scopes: text("scopes").array().notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("api_keys_key_hash_unique").on(t.keyHash),
    uniqueIndex("api_keys_tenant_id_id_idx").on(t.tenantId, t.id),
    check("api_keys_scopes_check", sql`${t.scopes} <@ ARRAY['read:orders', 'read:contacts', 'write:messages']::text[] AND cardinality(${t.scopes}) > 0`),
  ],
);

/**
 * Outbound webhook endpoint. `secret_encrypted` is the HMAC signing secret (CipherBox, AAD =
 * tenant + "webhook_endpoint_secret"); the worker decrypts it to sign each delivery.
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    description: text("description"),
    events: text("events").array().notNull(),
    secretEncrypted: bytea("secret_encrypted").notNull(),
    secretHint: text("secret_hint"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    disabledReason: text("disabled_reason"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_endpoints_tenant_id_id_idx").on(t.tenantId, t.id),
    check("webhook_endpoints_status_check", sql`${t.status} IN ('active', 'disabled')`),
    check(
      "webhook_endpoints_events_check",
      sql`${t.events} <@ ARRAY['order.created', 'order.paid', 'contact.created', 'message.received']::text[] AND cardinality(${t.events}) > 0`,
    ),
  ],
);

export const webhookDeliveryStatuses = ["pending", "delivered", "failed"] as const;

/**
 * One event for one endpoint (transactional outbox + delivery log). Inserted in the same
 * transaction as the state change; the worker tick delivers due rows. `(endpoint_id, event_id)`
 * is unique so an event is enqueued at most once per endpoint.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull(),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: webhookDeliveryStatuses }).notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow(),
    lastStatusCode: smallint("last_status_code"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_deliveries_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("webhook_deliveries_endpoint_event_unique").on(t.endpointId, t.eventId),
    index("webhook_deliveries_due_idx").on(t.tenantId, t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
    index("webhook_deliveries_endpoint_created_idx").on(t.tenantId, t.endpointId, t.createdAt),
    check("webhook_deliveries_status_check", sql`${t.status} IN ('pending', 'delivered', 'failed')`),
    foreignKey({
      name: "webhook_deliveries_tenant_endpoint_fk",
      columns: [t.tenantId, t.endpointId],
      foreignColumns: [webhookEndpoints.tenantId, webhookEndpoints.id],
    }).onDelete("cascade"),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
