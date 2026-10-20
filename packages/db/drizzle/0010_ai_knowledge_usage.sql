CREATE TYPE "public"."ai_action_decision" AS ENUM('auto', 'approve', 'deny');--> statement-breakpoint
CREATE TYPE "public"."ai_action_status" AS ENUM('proposed', 'pending_approval', 'approved', 'rejected', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_kind" AS ENUM('csv', 'pdf', 'faq', 'text', 'url');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('llm_tokens', 'embedding_tokens', 'transcription_seconds', 'wa_message', 'storage', 'psp_fee');--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"ai_mode_default" "ai_mode" DEFAULT 'assist' NOT NULL,
	"confidence_threshold" numeric(3, 2) DEFAULT '0.75' NOT NULL,
	"approval_threshold_minor" bigint,
	"policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configs_tenant_version_unique" UNIQUE("tenant_id","version")
);
--> statement-breakpoint
CREATE TABLE "action_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"decided_by" uuid NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" numeric,
	"decision" "ai_action_decision" NOT NULL,
	"decision_reason" text,
	"status" "ai_action_status" DEFAULT 'proposed' NOT NULL,
	"result" jsonb,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "llm_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key_encrypted" "bytea",
	"api_key_hint" text,
	"model_cheap" text NOT NULL,
	"model_strong" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"is_active" boolean DEFAULT false NOT NULL,
	"monthly_budget_minor" bigint,
	"budget_currency" char(3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_connections_provider_check" CHECK ("llm_connections"."provider" IN ('openai', 'openrouter', 'deepseek', 'custom')),
	CONSTRAINT "llm_connections_budget_check" CHECK ("llm_connections"."monthly_budget_minor" IS NULL OR ("llm_connections"."monthly_budget_minor" >= 0 AND "llm_connections"."budget_currency" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_version" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector,
	"embedding_model" text,
	"embedding_dims" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "knowledge_source_kind" NOT NULL,
	"title" text NOT NULL,
	"storage_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "knowledge_source_status" DEFAULT 'pending' NOT NULL,
	"content_hash" text,
	"error" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"quantity" numeric NOT NULL,
	"unit" text NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_action_id_ai_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."ai_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_connections" ADD CONSTRAINT "llm_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_configs_tenant_id_id_idx" ON "agent_configs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configs_tenant_active_unique" ON "agent_configs" USING btree ("tenant_id") WHERE "agent_configs"."is_active";--> statement-breakpoint
CREATE INDEX "action_approvals_tenant_id_id_idx" ON "action_approvals" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "action_approvals_action_id_idx" ON "action_approvals" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "ai_actions_tenant_id_id_idx" ON "ai_actions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "ai_actions_tenant_conversation_idx" ON "ai_actions" USING btree ("tenant_id","conversation_id");--> statement-breakpoint
CREATE INDEX "llm_connections_tenant_id_id_idx" ON "llm_connections" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_connections_tenant_active_unique" ON "llm_connections" USING btree ("tenant_id") WHERE "llm_connections"."is_active";--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tenant_id_id_idx" ON "knowledge_chunks" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tenant_source_idx" ON "knowledge_chunks" USING btree ("tenant_id","source_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_content_fts_idx" ON "knowledge_chunks" USING gin (to_tsvector('simple', "content"));--> statement-breakpoint
CREATE INDEX "knowledge_sources_tenant_id_id_idx" ON "knowledge_sources" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "usage_ledger_tenant_id_id_idx" ON "usage_ledger" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "usage_ledger_tenant_occurred_at_idx" ON "usage_ledger" USING btree ("tenant_id","occurred_at");