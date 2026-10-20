-- Broadcast campaigns (T11). Composite nullable FK to messages uses ON DELETE SET NULL (col) (edited by hand, as in 0013).
CREATE TYPE "public"."broadcast_recipient_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'scheduled', 'sending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "broadcast_recipient_status" DEFAULT 'pending' NOT NULL,
	"message_id" uuid,
	"error" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_recipients_broadcast_contact_unique" UNIQUE("tenant_id","broadcast_id","contact_id"),
	CONSTRAINT "broadcast_recipients_broadcast_phone_unique" UNIQUE("tenant_id","broadcast_id","phone_e164")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"variable_mapping" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" jsonb DEFAULT '{"tags":[],"excludeTags":[]}'::jsonb NOT NULL,
	"status" "broadcast_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reserved_sends" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_tenant_broadcast_fk" FOREIGN KEY ("tenant_id","broadcast_id") REFERENCES "public"."broadcasts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_tenant_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE SET NULL ("message_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_tenant_channel_connection_fk" FOREIGN KEY ("tenant_id","channel_connection_id") REFERENCES "public"."channel_connections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."message_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_recipients_tenant_id_id_idx" ON "broadcast_recipients" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_tenant_broadcast_status_idx" ON "broadcast_recipients" USING btree ("tenant_id","broadcast_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_recipients_tenant_message_unique" ON "broadcast_recipients" USING btree ("tenant_id","message_id") WHERE "broadcast_recipients"."message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcasts_tenant_id_id_idx" ON "broadcasts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "broadcasts_tenant_status_scheduled_idx" ON "broadcasts" USING btree ("tenant_id","status","scheduled_at");