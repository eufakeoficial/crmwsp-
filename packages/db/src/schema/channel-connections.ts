import { sql } from "drizzle-orm";
import { customType, foreignKey, index, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** Gupshup Partner API app id (uuid); needed for template submission/listing. Not a secret. */
    gupshupAppId: text("gupshup_app_id"),
    /** Gupshup Partner API app token (`Authorization` header), encrypted like the API key. */
    partnerTokenEncrypted: bytea("partner_token_encrypted"),
    webhookToken: text("webhook_token").notNull().unique("channel_connections_webhook_token_unique"),
    status: channelConnectionStatus("status").notNull().default("pending"),
    /** When this channel's phone/WABA was recorded in trial_claims (0069). */
    trialIdentityClaimedAt: timestamp("trial_identity_claimed_at", { withTimezone: true }),
    /** Number quality from Meta events (0078): GREEN/YELLOW/RED/UNKNOWN; null = never reported. */
    qualityRating: text("quality_rating", { enum: ["GREEN", "YELLOW", "RED", "UNKNOWN"] }),
    /** ok | flagged | restricted | disabled, from phone quality / account events (0078). */
    accountStatus: text("account_status", { enum: ["ok", "flagged", "restricted", "disabled"] }).notNull().default("ok"),
    messagingLimit: text("messaging_limit"),
    qualityUpdatedAt: timestamp("quality_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("channel_connections_tenant_phone_unique").on(t.tenantId, t.phoneE164),
    uniqueIndex("channel_connections_tenant_id_id_idx").on(t.tenantId, t.id),
  ],
);

/** Meta account/number/template events per channel (0078, ADR 0021). Whitelisted fields only. */
export const channelQualityEvents = pgTable(
  "channel_quality_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    /** Source inbound_events row (idempotency: one row per event). */
    inboundEventId: uuid("inbound_event_id"),
    field: text("field", {
      enum: ["phone_number_quality_update", "account_update", "message_template_status_update", "message_template_quality_update"],
    }).notNull(),
    event: text("event"),
    quality: text("quality"),
    messagingLimit: text("messaging_limit"),
    templateName: text("template_name"),
    templateLanguage: text("template_language"),
    reason: text("reason"),
    severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("channel_quality_events_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("channel_quality_events_inbound_event_unique").on(t.tenantId, t.inboundEventId).where(sql`${t.inboundEventId} IS NOT NULL`),
    index("channel_quality_events_channel_created_idx").on(t.tenantId, t.channelConnectionId, t.createdAt),
    index("channel_quality_events_created_idx").on(t.createdAt),
    foreignKey({
      name: "channel_quality_events_channel_fk",
      columns: [t.tenantId, t.channelConnectionId],
      foreignColumns: [channelConnections.tenantId, channelConnections.id],
    }).onDelete("cascade"),
  ],
);

export type ChannelQualityEvent = typeof channelQualityEvents.$inferSelect;
export type ChannelConnection = typeof channelConnections.$inferSelect;
export type NewChannelConnection = typeof channelConnections.$inferInsert;
export type ChannelProvider = (typeof channelProvider.enumValues)[number];
export type ChannelConnectionStatus = (typeof channelConnectionStatus.enumValues)[number];
