-- Gupshup Partner API credentials per channel (templates API, ADR 0004). Both nullable: channels
-- created before this migration have none and are skipped by the template sync. The token is stored
-- encrypted (packages/crypto, AAD purpose gupshup_partner_token). RLS of channel_connections already
-- covers the row, so the new columns inherit tenant isolation; no policy or grant change is needed.
ALTER TABLE "channel_connections" ADD COLUMN "gupshup_app_id" text;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "partner_token_encrypted" bytea;
