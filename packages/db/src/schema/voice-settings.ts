import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./channel-connections.js";
import { tenants } from "./tenants.js";

export const voiceReplyModes = ["off", "mirror", "always"] as const;
export type VoiceReplyMode = (typeof voiceReplyModes)[number];

export const ttsProviders = ["elevenlabs"] as const;
export type TtsProviderName = (typeof ttsProviders)[number];

/**
 * Voice replies (TTS) settings of a tenant, one row per tenant. BYOK: the TTS API key is stored only
 * as ciphertext (AAD purpose `tts_api_key`); `api_key_hint` keeps the last characters for display.
 */
export const voiceSettings = pgTable(
  "voice_settings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ttsProviders }).notNull().default("elevenlabs"),
    apiKeyEncrypted: bytea("api_key_encrypted"),
    apiKeyHint: text("api_key_hint"),
    voiceId: text("voice_id"),
    modelId: text("model_id").notNull().default("eleven_multilingual_v2"),
    replyMode: text("reply_mode", { enum: voiceReplyModes }).notNull().default("off"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("voice_settings_tenant_unique").on(t.tenantId),
    index("voice_settings_tenant_id_id_idx").on(t.tenantId, t.id),
    check("voice_settings_provider_check", sql`${t.provider} IN ('elevenlabs')`),
    check("voice_settings_reply_mode_check", sql`${t.replyMode} IN ('off', 'mirror', 'always')`),
  ],
);

export type VoiceSettings = typeof voiceSettings.$inferSelect;
export type NewVoiceSettings = typeof voiceSettings.$inferInsert;
