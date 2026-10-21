CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by_user_id" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_scopes_check" CHECK ("api_keys"."scopes" <@ ARRAY['read:orders', 'read:contacts', 'write:messages']::text[] AND cardinality("api_keys"."scopes") > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"last_status_code" smallint,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_endpoint_event_unique" UNIQUE("endpoint_id","event_id"),
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("webhook_deliveries"."status" IN ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"events" text[] NOT NULL,
	"secret_encrypted" "bytea" NOT NULL,
	"secret_hint" text,
	"status" text DEFAULT 'active' NOT NULL,
	"disabled_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_status_check" CHECK ("webhook_endpoints"."status" IN ('active', 'disabled')),
	CONSTRAINT "webhook_endpoints_events_check" CHECK ("webhook_endpoints"."events" <@ ARRAY['order.created', 'order.paid', 'contact.created', 'message.received']::text[] AND cardinality("webhook_endpoints"."events") > 0)
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_tenant_id_id_idx" ON "api_keys" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_tenant_id_id_idx" ON "webhook_deliveries" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("tenant_id","next_attempt_at") WHERE "webhook_deliveries"."status" = 'pending';
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_created_idx" ON "webhook_deliveries" USING btree ("tenant_id","endpoint_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoints_tenant_id_id_idx" ON "webhook_endpoints" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_endpoint_fk" FOREIGN KEY ("tenant_id","endpoint_id") REFERENCES "public"."webhook_endpoints"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
