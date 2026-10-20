-- F3-B: pipeline, tasks, catalog (products/variants/media), quotes, orders, stock,
-- consents, templates and follow-ups. Hand-ordered after drizzle-kit: all indexes
-- (incl. the UNIQUE (tenant_id, id) FK targets) before the composite FKs; nullable
-- composite FKs use ON DELETE SET NULL (col) (PG 15+) so tenant_id is never nulled;
-- pipeline_stages position UNIQUE is DEFERRABLE (reorder inside one transaction).
CREATE TYPE "public"."order_fulfillment" AS ENUM('shipping', 'pickup', 'digital', 'service');
--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'pending_payment', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded');
--> statement-breakpoint
CREATE TYPE "public"."order_stock_state" AS ENUM('none', 'reserved', 'committed', 'released');
--> statement-breakpoint
CREATE TYPE "public"."product_media_kind" AS ENUM('image', 'video_link', 'document');
--> statement-breakpoint
CREATE TYPE "public"."stock_movement_reason" AS ENUM('order_reserved', 'order_committed', 'order_released', 'manual_adjust', 'import');
--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('marketing', 'service', 'follow_up');
--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'revoked');
--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('suggested', 'scheduled', 'sent', 'skipped', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('marketing', 'utility', 'authentication');
--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('approved', 'pending', 'rejected', 'paused', 'disabled');
--> statement-breakpoint
CREATE TYPE "public"."stage_changed_by_type" AS ENUM('user', 'ai', 'system');
--> statement-breakpoint
CREATE TYPE "public"."opportunity_source" AS ENUM('whatsapp', 'manual', 'ai');
--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage_kind" AS ENUM('open', 'won', 'lost');
--> statement-breakpoint
CREATE TYPE "public"."task_origin" AS ENUM('manual', 'ai', 'automation');
--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'done', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."product_kind" AS ENUM('physical', 'service', 'digital');
--> statement-breakpoint
CREATE TYPE "public"."product_price_source" AS ENUM('manual', 'knowledge');
--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."quote_created_by_type" AS ENUM('user', 'ai');
--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'cancelled');
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid,
	"product_id" uuid,
	"description" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"tax_rate_bp" integer DEFAULT 0 NOT NULL,
	"line_total_minor" bigint NOT NULL,
	CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_check" CHECK ("order_items"."unit_price_minor" >= 0),
	CONSTRAINT "order_items_discount_check" CHECK ("order_items"."discount_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "order_items_tax_rate_check" CHECK ("order_items"."tax_rate_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"opportunity_id" uuid,
	"quote_id" uuid,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"fulfillment" "order_fulfillment" NOT NULL,
	"shipping_address" jsonb,
	"notes" text,
	"stock_state" "order_stock_state" DEFAULT 'none' NOT NULL,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by_type" "quote_created_by_type" NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"kind" "product_media_kind" NOT NULL,
	"storage_key" text,
	"url" text,
	"alt" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_source_check" CHECK (("product_media"."kind" = 'video_link' AND "product_media"."url" IS NOT NULL AND "product_media"."storage_key" IS NULL)
        OR ("product_media"."kind" IN ('image', 'document') AND "product_media"."storage_key" IS NOT NULL AND "product_media"."url" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"option_key" text DEFAULT '' NOT NULL,
	"price_minor" bigint,
	"compare_at_minor" bigint,
	"stock_on_hand" integer DEFAULT 0 NOT NULL,
	"stock_reserved" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_tenant_product_id_unique" UNIQUE("tenant_id","product_id","id"),
	CONSTRAINT "product_variants_tenant_product_option_key_unique" UNIQUE("tenant_id","product_id","option_key"),
	CONSTRAINT "product_variants_stock_on_hand_check" CHECK ("product_variants"."stock_on_hand" >= 0),
	CONSTRAINT "product_variants_stock_reserved_check" CHECK ("product_variants"."stock_reserved" >= 0),
	CONSTRAINT "product_variants_price_check" CHECK ("product_variants"."price_minor" IS NULL OR "product_variants"."price_minor" >= 0),
	CONSTRAINT "product_variants_compare_at_check" CHECK ("product_variants"."compare_at_minor" IS NULL OR "product_variants"."compare_at_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "stock_movement_reason" NOT NULL,
	"ref_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"status" "consent_status" NOT NULL,
	"evidence" jsonb DEFAULT '{"source":"unknown"}'::jsonb NOT NULL,
	"granted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_tenant_contact_kind_unique" UNIQUE("tenant_id","contact_id","kind")
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"conversation_id" uuid NOT NULL,
	"quote_id" uuid,
	"reason" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "follow_up_status" DEFAULT 'suggested' NOT NULL,
	"requires_template" boolean DEFAULT false NOT NULL,
	"template_id" uuid,
	"consent_checked_at" timestamp with time zone,
	"skip_reason" text,
	"sent_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"category" "template_category" NOT NULL,
	"status" "template_status" DEFAULT 'pending' NOT NULL,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_id" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_tenant_channel_name_language_unique" UNIQUE("tenant_id","channel_connection_id","name","language")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"value_minor" bigint,
	"currency" char(3) NOT NULL,
	"owner_user_id" uuid,
	"source" "opportunity_source" DEFAULT 'manual' NOT NULL,
	"next_action_at" timestamp with time zone,
	"lost_reason" text,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"changed_by_type" "stage_changed_by_type" NOT NULL,
	"changed_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "pipeline_stage_kind" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_tenant_pipeline_id_unique" UNIQUE("tenant_id","pipeline_id","id"),
	CONSTRAINT "pipeline_stages_tenant_pipeline_key_unique" UNIQUE("tenant_id","pipeline_id","key"),
	CONSTRAINT "pipeline_stages_tenant_pipeline_position_unique" UNIQUE("tenant_id","pipeline_id","position") DEFERRABLE INITIALLY IMMEDIATE
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp with time zone,
	"assigned_user_id" uuid,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"origin" "task_origin" DEFAULT 'manual' NOT NULL,
	"opportunity_id" uuid,
	"conversation_id" uuid,
	"ai_action_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_sequences_tenant_id_kind_year_pk" PRIMARY KEY("tenant_id","kind","year"),
	CONSTRAINT "document_sequences_kind_check" CHECK ("document_sequences"."kind" IN ('quote', 'order'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text,
	"slug" text,
	"kind" "product_kind" DEFAULT 'physical' NOT NULL,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"category" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"video_url" text,
	"track_stock" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit" text,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"tax_rate_bp" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"price_source" "product_price_source" DEFAULT 'manual' NOT NULL,
	"knowledge_chunk_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_check" CHECK ("products"."price_minor" >= 0),
	CONSTRAINT "products_tax_rate_check" CHECK ("products"."tax_rate_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"product_version" integer,
	"knowledge_chunk_id" uuid,
	"description" text NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"unit" text,
	"unit_price_minor" bigint NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"tax_rate_bp" integer DEFAULT 0 NOT NULL,
	"line_total_minor" bigint NOT NULL,
	CONSTRAINT "quote_items_tenant_quote_position_unique" UNIQUE("tenant_id","quote_id","position"),
	CONSTRAINT "quote_items_quantity_check" CHECK ("quote_items"."quantity_milli" > 0),
	CONSTRAINT "quote_items_unit_price_check" CHECK ("quote_items"."unit_price_minor" >= 0),
	CONSTRAINT "quote_items_discount_check" CHECK ("quote_items"."discount_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "quote_items_tax_rate_check" CHECK ("quote_items"."tax_rate_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"opportunity_id" uuid,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"notes" text,
	"terms" text,
	"pdf_storage_key" text,
	"approval_action_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accept_token_hash" "bytea",
	"created_by_type" "quote_created_by_type" NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "quotes_total_check" CHECK ("quotes"."total_minor" >= 0)
);
--> statement-breakpoint
DROP INDEX "channel_connections_tenant_id_id_idx";
--> statement-breakpoint
DROP INDEX "contacts_tenant_id_id_idx";
--> statement-breakpoint
DROP INDEX "knowledge_chunks_tenant_id_id_idx";
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ai_action_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_tenant_id_id_idx" ON "order_items" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_id_id_idx" ON "orders" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_tenant_id_id_idx" ON "product_media" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_tenant_id_id_idx" ON "product_variants" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_tenant_sku_active_unique" ON "product_variants" USING btree ("tenant_id","sku") WHERE "product_variants"."sku" IS NOT NULL AND "product_variants"."is_active";
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_tenant_id_id_idx" ON "stock_movements" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "consents_tenant_id_id_idx" ON "consents" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_tenant_id_id_idx" ON "follow_ups" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_tenant_id_id_idx" ON "message_templates" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_tenant_id_id_idx" ON "opportunities" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_stage_history_tenant_id_id_idx" ON "opportunity_stage_history" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_tenant_id_id_idx" ON "pipeline_stages" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_tenant_id_id_idx" ON "pipelines" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_tenant_default_unique" ON "pipelines" USING btree ("tenant_id") WHERE "pipelines"."is_default";
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_tenant_id_id_idx" ON "tasks" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_id_id_idx" ON "products" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_slug_unique" ON "products" USING btree ("tenant_id","slug") WHERE "products"."slug" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_sku_active_unique" ON "products" USING btree ("tenant_id","sku") WHERE "products"."sku" IS NOT NULL AND "products"."is_active";
--> statement-breakpoint
CREATE UNIQUE INDEX "quote_items_tenant_id_id_idx" ON "quote_items" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_tenant_id_id_idx" ON "quotes" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_tenant_id_id_idx" ON "channel_connections" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_id_id_idx" ON "contacts" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_tenant_id_id_idx" ON "knowledge_chunks" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "order_items_tenant_order_idx" ON "order_items" USING btree ("tenant_id","order_id");
--> statement-breakpoint
CREATE INDEX "orders_tenant_status_created_idx" ON "orders" USING btree ("tenant_id","status","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "orders_tenant_contact_idx" ON "orders" USING btree ("tenant_id","contact_id");
--> statement-breakpoint
CREATE INDEX "product_media_tenant_product_idx" ON "product_media" USING btree ("tenant_id","product_id","position");
--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_variant_idx" ON "stock_movements" USING btree ("tenant_id","variant_id","created_at");
--> statement-breakpoint
CREATE INDEX "follow_ups_tenant_status_scheduled_idx" ON "follow_ups" USING btree ("tenant_id","status","scheduled_at");
--> statement-breakpoint
CREATE INDEX "opportunities_tenant_stage_updated_idx" ON "opportunities" USING btree ("tenant_id","stage_id","updated_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "opportunities_tenant_contact_idx" ON "opportunities" USING btree ("tenant_id","contact_id");
--> statement-breakpoint
CREATE INDEX "opportunity_stage_history_tenant_opportunity_idx" ON "opportunity_stage_history" USING btree ("tenant_id","opportunity_id","created_at");
--> statement-breakpoint
CREATE INDEX "tasks_tenant_status_due_idx" ON "tasks" USING btree ("tenant_id","status","due_at");
--> statement-breakpoint
CREATE INDEX "quotes_tenant_contact_idx" ON "quotes" USING btree ("tenant_id","contact_id");
--> statement-breakpoint
CREATE INDEX "quotes_tenant_status_idx" ON "quotes" USING btree ("tenant_id","status");
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE SET NULL ("variant_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE SET NULL ("product_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_opportunity_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE SET NULL ("opportunity_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE SET NULL ("quote_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_tenant_product_variant_fk" FOREIGN KEY ("tenant_id","product_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","product_id","id") ON DELETE SET NULL ("variant_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_opportunity_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE SET NULL ("opportunity_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE SET NULL ("quote_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."message_templates"("tenant_id","id") ON DELETE SET NULL ("template_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_sent_message_fk" FOREIGN KEY ("tenant_id","sent_message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE SET NULL ("sent_message_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_channel_connection_fk" FOREIGN KEY ("tenant_id","channel_connection_id") REFERENCES "public"."channel_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_pipeline_stage_fk" FOREIGN KEY ("tenant_id","pipeline_id","stage_id") REFERENCES "public"."pipeline_stages"("tenant_id","pipeline_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_tenant_opportunity_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_tenant_from_stage_fk" FOREIGN KEY ("tenant_id","from_stage_id") REFERENCES "public"."pipeline_stages"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_tenant_to_stage_fk" FOREIGN KEY ("tenant_id","to_stage_id") REFERENCES "public"."pipeline_stages"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_opportunity_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE SET NULL ("opportunity_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_ai_action_fk" FOREIGN KEY ("tenant_id","ai_action_id") REFERENCES "public"."ai_actions"("tenant_id","id") ON DELETE SET NULL ("ai_action_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_knowledge_chunk_fk" FOREIGN KEY ("tenant_id","knowledge_chunk_id") REFERENCES "public"."knowledge_chunks"("tenant_id","id") ON DELETE SET NULL ("knowledge_chunk_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE SET NULL ("product_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenant_knowledge_chunk_fk" FOREIGN KEY ("tenant_id","knowledge_chunk_id") REFERENCES "public"."knowledge_chunks"("tenant_id","id") ON DELETE SET NULL ("knowledge_chunk_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_opportunity_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE SET NULL ("opportunity_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_approval_action_fk" FOREIGN KEY ("tenant_id","approval_action_id") REFERENCES "public"."ai_actions"("tenant_id","id") ON DELETE SET NULL ("approval_action_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_ai_action_fk" FOREIGN KEY ("tenant_id","ai_action_id") REFERENCES "public"."ai_actions"("tenant_id","id") ON DELETE SET NULL ("ai_action_id") ON UPDATE no action;
