CREATE TABLE "tenant_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" text DEFAULT 'start' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_plans_tenant_unique" UNIQUE("tenant_id"),
	CONSTRAINT "tenant_plans_plan_check" CHECK ("tenant_plans"."plan" IN ('start', 'pro'))
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" char(7) NOT NULL,
	"limit_key" text NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_tenant_period_key_unique" UNIQUE("tenant_id","period","limit_key"),
	CONSTRAINT "usage_counters_key_check" CHECK ("usage_counters"."limit_key" IN ('ai_messages', 'broadcast_sends')),
	CONSTRAINT "usage_counters_used_check" CHECK ("usage_counters"."used" >= 0),
	CONSTRAINT "usage_counters_period_check" CHECK ("usage_counters"."period" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "tenant_plans" ADD CONSTRAINT "tenant_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
