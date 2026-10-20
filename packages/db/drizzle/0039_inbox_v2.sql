-- Inbox v2 (T23): inbox folder open/closed, unread flag, assignment time, internal notes,
-- reminders, tag catalog, canned responses and per-contact automation pause.
-- conversations(tenant_id, id) already has a unique index (0012) for the composite FKs.
CREATE TABLE "canned_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"shortcut" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"note" text,
	"done" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "tags_color_check" CHECK ("tags"."color" IS NULL OR "tags"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "automations_paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "inbox_status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "marked_unread" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reminders" ADD CONSTRAINT "conversation_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reminders" ADD CONSTRAINT "conversation_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reminders" ADD CONSTRAINT "conversation_reminders_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canned_responses_tenant_id_id_idx" ON "canned_responses" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "canned_responses_tenant_shortcut_unique" ON "canned_responses" USING btree ("tenant_id","shortcut") WHERE "canned_responses"."shortcut" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_notes_tenant_id_id_idx" ON "conversation_notes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "conversation_notes_conversation_idx" ON "conversation_notes" USING btree ("tenant_id","conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_reminders_tenant_id_id_idx" ON "conversation_reminders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "conversation_reminders_due_idx" ON "conversation_reminders" USING btree ("tenant_id","remind_at") WHERE "conversation_reminders"."done" = false;--> statement-breakpoint
CREATE INDEX "conversation_reminders_conversation_idx" ON "conversation_reminders" USING btree ("tenant_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_tenant_id_id_idx" ON "tags" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_inbox_status_idx" ON "conversations" USING btree ("tenant_id","inbox_status","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_tenant_assigned_idx" ON "conversations" USING btree ("tenant_id","assigned_user_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_inbox_status_check" CHECK ("conversations"."inbox_status" IN ('open', 'closed'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" IN ('order_confirmed', 'order_paid', 'handoff', 'approval_requested', 'payment_review', 'reminder'));--> statement-breakpoint
-- Backfill: handoffs (`pending`) need a human; resolved or AI-owned conversations are closed.
UPDATE "conversations" SET "inbox_status" = 'closed', "closed_at" = "updated_at"
  WHERE "status" = 'resolved' OR ("status" = 'open' AND "ai_mode" = 'auto' AND "assigned_user_id" IS NULL);--> statement-breakpoint
UPDATE "conversations" SET "assigned_at" = "updated_at" WHERE "assigned_user_id" IS NOT NULL;
