CREATE TABLE "payment_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"secret_key_encrypted" "bytea" NOT NULL,
	"webhook_secret_encrypted" "bytea" NOT NULL,
	"secret_key_hint" text,
	"webhook_token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_connections_webhook_token_unique" UNIQUE("webhook_token"),
	CONSTRAINT "payment_connections_tenant_provider_unique" UNIQUE("tenant_id","provider"),
	CONSTRAINT "payment_connections_provider_check" CHECK ("payment_connections"."provider" IN ('stripe')),
	CONSTRAINT "payment_connections_status_check" CHECK ("payment_connections"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_ref" text,
	"payment_id" uuid,
	"outcome" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_tenant_provider_event_unique" UNIQUE("tenant_id","provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"url" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_by" text,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_provider_ref_unique" UNIQUE("tenant_id","provider","provider_ref"),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('pending', 'succeeded', 'failed', 'expired')),
	CONSTRAINT "payments_verified_by_check" CHECK ("payments"."verified_by" IS NULL OR "payments"."verified_by" IN ('webhook', 'reconciliation')),
	CONSTRAINT "payments_succeeded_verified_check" CHECK ("payments"."status" <> 'succeeded' OR ("payments"."verified_by" IS NOT NULL AND "payments"."paid_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_connections_tenant_id_id_idx" ON "payment_connections" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "payment_events_tenant_received_idx" ON "payment_events" USING btree ("tenant_id","received_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_id_id_idx" ON "payments" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "payments_tenant_order_idx" ON "payments" USING btree ("tenant_id","order_id");
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
