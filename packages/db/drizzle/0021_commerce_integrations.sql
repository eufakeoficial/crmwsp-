CREATE TABLE "commerce_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"webhook_secret_encrypted" "bytea" NOT NULL,
	"access_token_encrypted" "bytea",
	"secret_hint" text,
	"shop_domain" text,
	"shop_currency" char(3),
	"webhook_token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_connections_webhook_token_unique" UNIQUE("webhook_token"),
	CONSTRAINT "commerce_connections_tenant_provider_unique" UNIQUE("tenant_id","provider"),
	CONSTRAINT "commerce_connections_provider_check" CHECK ("commerce_connections"."provider" IN ('shopify', 'hotmart', 'kiwify', 'eduzz', 'gumroad', 'payhip')),
	CONSTRAINT "commerce_connections_status_check" CHECK ("commerce_connections"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "commerce_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"external_sale_id" uuid,
	"outcome" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_events_tenant_provider_event_unique" UNIQUE("tenant_id","provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "external_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint,
	"currency" char(3),
	"buyer_email" text,
	"buyer_phone_e164" text,
	"buyer_name" text,
	"product_ref" text,
	"product_name" text,
	"contact_id" uuid,
	"order_id" uuid,
	"verification" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_sales_tenant_provider_external_unique" UNIQUE("tenant_id","provider","external_id"),
	CONSTRAINT "external_sales_provider_check" CHECK ("external_sales"."provider" IN ('shopify', 'hotmart', 'kiwify', 'eduzz', 'gumroad', 'payhip')),
	CONSTRAINT "external_sales_status_check" CHECK ("external_sales"."status" IN ('pending', 'approved', 'refunded')),
	CONSTRAINT "external_sales_amount_check" CHECK ("external_sales"."amount_minor" IS NULL OR "external_sales"."amount_minor" >= 0),
	CONSTRAINT "external_sales_order_needs_hmac_check" CHECK ("external_sales"."order_id" IS NULL OR "external_sales"."verification" = 'hmac_body')
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "commerce_connections" ADD CONSTRAINT "commerce_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_events" ADD CONSTRAINT "commerce_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sales" ADD CONSTRAINT "external_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sales" ADD CONSTRAINT "external_sales_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sales" ADD CONSTRAINT "external_sales_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_connections_tenant_id_id_idx" ON "commerce_connections" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "commerce_events_tenant_received_idx" ON "commerce_events" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_sales_tenant_id_id_idx" ON "external_sales" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "external_sales_tenant_contact_idx" ON "external_sales" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "external_sales_tenant_occurred_idx" ON "external_sales" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_tenant_external_unique" ON "product_variants" USING btree ("tenant_id","external_source","external_id") WHERE "product_variants"."external_source" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_external_unique" ON "products" USING btree ("tenant_id","external_source","external_id") WHERE "products"."external_source" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_external_pair_check" CHECK (("product_variants"."external_source" IS NULL) = ("product_variants"."external_id" IS NULL));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_external_pair_check" CHECK (("products"."external_source" IS NULL) = ("products"."external_id" IS NULL));