-- F1-F inbox: per-conversation read marker (unread = inbound messages after last_read_at)
-- and idempotency key for outbound messages sent from the inbox. Both tables already
-- have RLS (0005) and table-level grants; no new policies needed.
ALTER TABLE "conversations" ADD COLUMN "last_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "client_message_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tenant_client_message_id_unique" ON "messages" USING btree ("tenant_id","client_message_id") WHERE "messages"."client_message_id" IS NOT NULL;