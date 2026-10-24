import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { channelConnections, channelProvider } from "./channel-connections.js";
import { tenants } from "./tenants.js";

/**
 * Raw webhook events. tenant_id is nullable because the tenant is resolved
 * from the webhook token at ingestion time. The app role cannot INSERT here:
 * ingestion goes through the SECURITY DEFINER function
 * `ingest_inbound_event` (see drizzle/0005_rls_messaging.sql).
 *
 * The DB enum also holds `nowpayments` (0062): SaaS subscription IPNs ingested by
 * `ingest_nowpayments_event` (tenant resolved from the charge, no channel connection). It is
 * not part of the TS `channelProvider` enum on purpose (channels never use it); code reading
 * those rows filters by provider in SQL.
 */
export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    provider: channelProvider("provider").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    channelConnectionId: uuid("channel_connection_id").references(() => channelConnections.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").$type<unknown>().notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    unique("inbound_events_provider_dedupe_unique").on(t.provider, t.dedupeKey),
    index("inbound_events_tenant_id_id_idx").on(t.tenantId, t.id),
  ],
);

export type InboundEvent = typeof inboundEvents.$inferSelect;
export type NewInboundEvent = typeof inboundEvents.$inferInsert;
