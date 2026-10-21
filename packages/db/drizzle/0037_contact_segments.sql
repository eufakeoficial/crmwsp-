CREATE TABLE "contact_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_segments_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "source" text DEFAULT 'organic' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_segments" ADD CONSTRAINT "contact_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_segments" ADD CONSTRAINT "contact_segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_segments_tenant_id_id_idx" ON "contact_segments" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_source_check" CHECK ("contacts"."source" IN ('organic', 'api', 'import'));