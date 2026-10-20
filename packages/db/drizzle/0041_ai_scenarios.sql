-- F6 conversation simulator: saved scenarios and a usage kind for simulated turns.
ALTER TYPE "public"."usage_kind" ADD VALUE IF NOT EXISTS 'simulation';--> statement-breakpoint
CREATE TABLE "ai_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expectations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ai_scenarios" ADD CONSTRAINT "ai_scenarios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_scenarios_tenant_id_id_idx" ON "ai_scenarios" USING btree ("tenant_id","id");
