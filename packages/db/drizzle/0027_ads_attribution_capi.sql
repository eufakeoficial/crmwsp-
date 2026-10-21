CREATE TABLE "ad_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"source_id" text,
	"source_type" text,
	"source_url" text,
	"headline" text,
	"ctwa_clid" text,
	"first_message_external_id" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_attributions_tenant_contact_unique" UNIQUE("tenant_id","contact_id"),
	CONSTRAINT "ad_attributions_identity_check" CHECK ("ad_attributions"."source_id" IS NOT NULL OR "ad_attributions"."ctwa_clid" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ad_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"label" text,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_spend_tenant_source_currency_unique" UNIQUE("tenant_id","source_id","currency"),
	CONSTRAINT "ad_spend_amount_check" CHECK ("ad_spend"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "capi_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"order_id" uuid,
	"event_time" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capi_events_tenant_event_unique" UNIQUE("tenant_id","event_id"),
	CONSTRAINT "capi_events_name_check" CHECK ("capi_events"."event_name" IN ('Lead', 'Purchase')),
	CONSTRAINT "capi_events_status_check" CHECK ("capi_events"."status" IN ('pending', 'sent', 'dead')),
	CONSTRAINT "capi_events_purchase_order_check" CHECK ("capi_events"."event_name" <> 'Purchase' OR "capi_events"."order_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "meta_capi_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dataset_id" text NOT NULL,
	"access_token_encrypted" "bytea" NOT NULL,
	"token_hint" text,
	"test_event_code" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_capi_connections_tenant_unique" UNIQUE("tenant_id"),
	CONSTRAINT "meta_capi_connections_status_check" CHECK ("meta_capi_connections"."status" IN ('active', 'disabled')),
	CONSTRAINT "meta_capi_connections_dataset_check" CHECK ("meta_capi_connections"."dataset_id" ~ '^[0-9]{5,32}$')
);
--> statement-breakpoint
ALTER TABLE "ad_attributions" ADD CONSTRAINT "ad_attributions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "capi_events" ADD CONSTRAINT "capi_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meta_capi_connections" ADD CONSTRAINT "meta_capi_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ad_attributions_tenant_id_id_idx" ON "ad_attributions" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "ad_attributions_tenant_source_idx" ON "ad_attributions" USING btree ("tenant_id","source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ad_spend_tenant_id_id_idx" ON "ad_spend" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "capi_events_tenant_due_idx" ON "capi_events" USING btree ("tenant_id","status","next_attempt_at");
--> statement-breakpoint
ALTER TABLE "ad_attributions" ADD CONSTRAINT "ad_attributions_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ad_attributions" ADD CONSTRAINT "ad_attributions_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "capi_events" ADD CONSTRAINT "capi_events_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "capi_events" ADD CONSTRAINT "capi_events_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
