import { sql } from "drizzle-orm";
import { customType, index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** Raw binary column (postgres.js returns Buffer). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const channelProvider = pgEnum("channel_provider", ["gupshup", "360dialog"]);
export const channelConnectionStatus = pgEnum("channel_connection_status", ["pending", "active", "disabled"]);

/** WhatsApp number connected through a BSP. Credentials are stored encrypted (ciphertext only). */
export const channelConnections = pgTable(
  "channel_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: channelProvider("provider").notNull(),
    phoneE164: text("phone_e164").notNull(),
    externalAppId: text("external_app_id"),
    credentialsEncrypted: bytea("credentials_encrypted"),
    webhookToken: text("webhook_token").notNull().unique("channel_connections_webhook_token_unique"),
    status: channelConnectionStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("channel_connections_tenant_phone_unique").on(t.tenantId, t.phoneE164),
    index("channel_connections_tenant_id_id_idx").on(t.tenantId, t.id),
  ],
);

export type ChannelConnection = typeof channelConnections.$inferSelect;
export type NewChannelConnection = typeof channelConnections.$inferInsert;
export type ChannelProvider = (typeof channelProvider.enumValues)[number];
export type ChannelConnectionStatus = (typeof channelConnectionStatus.enumValues)[number];
