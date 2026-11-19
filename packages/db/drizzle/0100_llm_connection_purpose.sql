-- ADR 0024: optional dedicated transcription connection. Existing rows become 'chat'.
ALTER TABLE "llm_connections" ADD COLUMN "purpose" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_connections" ADD CONSTRAINT "llm_connections_purpose_check" CHECK ("llm_connections"."purpose" IN ('chat', 'transcription'));--> statement-breakpoint
DROP INDEX IF EXISTS "llm_connections_tenant_active_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "llm_connections_tenant_purpose_active_unique" ON "llm_connections" USING btree ("tenant_id","purpose") WHERE "llm_connections"."is_active";
