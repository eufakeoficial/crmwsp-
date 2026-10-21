-- Per-tenant sales playbook (guidance injected into the AI turn). One row per tenant.
CREATE TABLE "sales_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "sales_playbooks" ADD CONSTRAINT "sales_playbooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_playbooks" ADD CONSTRAINT "sales_playbooks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_playbooks_tenant_unique" ON "sales_playbooks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sales_playbooks_tenant_id_id_idx" ON "sales_playbooks" USING btree ("tenant_id","id");
