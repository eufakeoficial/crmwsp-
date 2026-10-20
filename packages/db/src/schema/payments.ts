import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea } from "./channel-connections.js";
import { orders } from "./commerce.js";
import { tenants } from "./tenants.js";

export const paymentProviders = ["stripe"] as const;
export type PaymentProviderName = (typeof paymentProviders)[number];

/**
 * Payment provider account of a tenant (BYOK). Secrets are stored only as ciphertext
 * (AAD = tenant + purpose). The webhook is authenticated by the opaque `webhook_token` in the
 * URL (resolves the tenant) AND the provider signature (verified with the decrypted secret).
 * Resolution by token goes through the SECURITY DEFINER `resolve_payment_webhook` (0018).
 */
export const paymentConnections = pgTable(
  "payment_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: paymentProviders }).notNull(),
    secretKeyEncrypted: bytea("secret_key_encrypted").notNull(),
    webhookSecretEncrypted: bytea("webhook_secret_encrypted").notNull(),
    secretKeyHint: text("secret_key_hint"),
    webhookToken: text("webhook_token").notNull().unique("payment_connections_webhook_token_unique"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payment_connections_tenant_provider_unique").on(t.tenantId, t.provider),
    uniqueIndex("payment_connections_tenant_id_id_idx").on(t.tenantId, t.id),
    check("payment_connections_provider_check", sql`${t.provider} IN ('stripe')`),
    check("payment_connections_status_check", sql`${t.status} IN ('active', 'disabled')`),
  ],
);

export const paymentStatuses = ["pending", "succeeded", "failed", "expired"] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

/**
 * One provider payment attempt (Stripe Checkout Session) for an order. `amount_minor` and
 * `currency` are snapshotted at creation; a webhook only marks the order paid when the
 * provider amount equals both this snapshot and the order total. `verified_by` is set only by
 * the webhook path ('webhook') or a provider fetch ('reconciliation').
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    provider: text("provider", { enum: paymentProviders }).notNull(),
    providerRef: text("provider_ref").notNull(),
    url: text("url").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: text("status", { enum: paymentStatuses }).notNull().default("pending"),
    verifiedBy: text("verified_by", { enum: ["webhook", "reconciliation"] }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_tenant_id_id_idx").on(t.tenantId, t.id),
    unique("payments_tenant_provider_ref_unique").on(t.tenantId, t.provider, t.providerRef),
    index("payments_tenant_order_idx").on(t.tenantId, t.orderId),
    check("payments_amount_check", sql`${t.amountMinor} > 0`),
    check("payments_status_check", sql`${t.status} IN ('pending', 'succeeded', 'failed', 'expired')`),
    check("payments_verified_by_check", sql`${t.verifiedBy} IS NULL OR ${t.verifiedBy} IN ('webhook', 'reconciliation')`),
    check("payments_succeeded_verified_check", sql`${t.status} <> 'succeeded' OR (${t.verifiedBy} IS NOT NULL AND ${t.paidAt} IS NOT NULL)`),
    foreignKey({
      name: "payments_tenant_order_fk",
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Signature-verified provider events, deduplicated per tenant by the provider event id
 * (Stripe `evt_...`). The row is inserted first (ON CONFLICT DO NOTHING) in the same
 * transaction that applies the event, so a replay is a no-op and a failed apply rolls back
 * the dedupe row too (the provider retries). `outcome` records why an event was ignored.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: paymentProviders }).notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    providerRef: text("provider_ref"),
    paymentId: uuid("payment_id"),
    outcome: text("outcome").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payment_events_tenant_provider_event_unique").on(t.tenantId, t.provider, t.eventId),
    index("payment_events_tenant_received_idx").on(t.tenantId, t.receivedAt),
  ],
);

export type PaymentConnection = typeof paymentConnections.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentEvent = typeof paymentEvents.$inferSelect;
