CREATE TABLE "ad_spend_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ad_id" text NOT NULL,
	"date" date NOT NULL,
	"spend_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"meta_conversations" integer DEFAULT 0 NOT NULL,
	"ad_name" text,
	"adset_id" text,
	"adset_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"ad_account_id" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_spend_daily_tenant_ad_date_unique" UNIQUE("tenant_id","ad_id","date"),
	CONSTRAINT "ad_spend_daily_amounts_check" CHECK ("ad_spend_daily"."spend_minor" >= 0 AND "ad_spend_daily"."impressions" >= 0 AND "ad_spend_daily"."clicks" >= 0 AND "ad_spend_daily"."meta_conversations" >= 0)
);
--> statement-breakpoint
CREATE TABLE "meta_ads_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ad_account_id" text NOT NULL,
	"ad_account_name" text,
	"currency" char(3),
	"access_token_encrypted" "bytea" NOT NULL,
	"token_hint" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_error" text,
	"target_roas_bp" integer DEFAULT 300 NOT NULL,
	"break_even_roas_bp" integer DEFAULT 100 NOT NULL,
	"min_spend_minor" bigint DEFAULT 2000 NOT NULL,
	"min_conversations" integer DEFAULT 5 NOT NULL,
	"pause_spend_minor" bigint DEFAULT 5000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_ads_connections_tenant_unique" UNIQUE("tenant_id"),
	CONSTRAINT "meta_ads_connections_status_check" CHECK ("meta_ads_connections"."status" IN ('active', 'disabled')),
	CONSTRAINT "meta_ads_connections_account_check" CHECK ("meta_ads_connections"."ad_account_id" ~ '^act_[0-9]{1,32}$'),
	CONSTRAINT "meta_ads_connections_thresholds_check" CHECK ("meta_ads_connections"."target_roas_bp" > 0 AND "meta_ads_connections"."break_even_roas_bp" > 0 AND "meta_ads_connections"."min_spend_minor" >= 0 AND "meta_ads_connections"."min_conversations" >= 0 AND "meta_ads_connections"."pause_spend_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ad_spend_daily" ADD CONSTRAINT "ad_spend_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_connections" ADD CONSTRAINT "meta_ads_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_spend_daily_tenant_date_idx" ON "ad_spend_daily" USING btree ("tenant_id","date");