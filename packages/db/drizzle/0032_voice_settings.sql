-- Voice replies via TTS (BYOK ElevenLabs): per-tenant settings and a usage kind for TTS characters.
ALTER TYPE "public"."usage_kind" ADD VALUE IF NOT EXISTS 'tts_characters';--> statement-breakpoint
CREATE TABLE "voice_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'elevenlabs' NOT NULL,
	"api_key_encrypted" "bytea",
	"api_key_hint" text,
	"voice_id" text,
	"model_id" text DEFAULT 'eleven_multilingual_v2' NOT NULL,
	"reply_mode" text DEFAULT 'off' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_settings_provider_check" CHECK ("voice_settings"."provider" IN ('elevenlabs')),
	CONSTRAINT "voice_settings_reply_mode_check" CHECK ("voice_settings"."reply_mode" IN ('off', 'mirror', 'always'))
);--> statement-breakpoint
ALTER TABLE "voice_settings" ADD CONSTRAINT "voice_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_settings_tenant_unique" ON "voice_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "voice_settings_tenant_id_id_idx" ON "voice_settings" USING btree ("tenant_id","id");
