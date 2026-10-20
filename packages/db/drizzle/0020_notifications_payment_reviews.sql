CREATE TABLE "notification_reads" (
	"tenant_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity" text,
	"entity_id" uuid,
	"conversation_id" uuid,
	"dedupe_key" text NOT NULL,
	"whatsapp_status" text DEFAULT 'pending' NOT NULL,
	"whatsapp_skip_reason" text,
	"whatsapp_message_id" uuid,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_tenant_dedupe_unique" UNIQUE("tenant_id","dedupe_key"),
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" IN ('order_confirmed', 'order_paid', 'handoff', 'approval_requested', 'payment_review')),
	CONSTRAINT "notifications_whatsapp_status_check" CHECK ("notifications"."whatsapp_status" IN ('pending', 'sent', 'skipped', 'not_configured'))
);
--> statement-breakpoint
CREATE TABLE "payment_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"attachment_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"extraction" text NOT NULL,
	"extracted_amount_minor" bigint,
	"extracted_currency" char(3),
	"extracted_date" text,
	"extracted_reference" text,
	"confidence" numeric(4, 3),
	"model" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reviews_tenant_message_unique" UNIQUE("tenant_id","message_id"),
	CONSTRAINT "payment_reviews_status_check" CHECK ("payment_reviews"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "payment_reviews_extraction_check" CHECK ("payment_reviews"."extraction" IN ('extracted', 'unsupported', 'failed')),
	CONSTRAINT "payment_reviews_confidence_check" CHECK ("payment_reviews"."confidence" IS NULL OR ("payment_reviews"."confidence" >= 0 AND "payment_reviews"."confidence" <= 1)),
	CONSTRAINT "payment_reviews_reviewed_check" CHECK ("payment_reviews"."status" = 'pending' OR ("payment_reviews"."reviewed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_tenant_notification_fk" FOREIGN KEY ("tenant_id","notification_id") REFERENCES "public"."notifications"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_reads_tenant_user_idx" ON "notification_reads" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_id_id_idx" ON "notifications" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "notifications_tenant_created_idx" ON "notifications" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_undispatched_idx" ON "notifications" USING btree ("tenant_id") WHERE "notifications"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reviews_tenant_id_id_idx" ON "payment_reviews" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "payment_reviews_tenant_status_idx" ON "payment_reviews" USING btree ("tenant_id","status","created_at");--> statement-breakpoint

-- Row Level Security (ADR 0002), same conventions as 0014/0018: tenant_isolation + system_owner.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_reads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notification_reads"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payment_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_reviews"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DO $$
DECLARE
  t text;
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH t IN ARRAY ARRAY['notifications', 'notification_reads', 'payment_reviews']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
  END LOOP;
END
$$;--> statement-breakpoint

-- Reviews are an audit trail: the app role may not delete them (only cascades from the order).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE DELETE, TRUNCATE ON public."payment_reviews" FROM crmwsp_app;
    REVOKE TRUNCATE ON public."notifications" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Notification tick enumeration (same pattern as follow_up_tenant_ids in 0019): ONLY the ids of
-- active tenants with undispatched notifications. Everything else runs inside withTenant.
CREATE FUNCTION public."notification_tenant_ids"()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT DISTINCT n."tenant_id" FROM public."notifications" n
  JOIN public."tenants" t ON t."id" = n."tenant_id"
  WHERE n."dispatched_at" IS NULL AND t."status" = 'active'
  ORDER BY n."tenant_id";
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."notification_tenant_ids"() FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."notification_tenant_ids"() TO crmwsp_app;
  END IF;
END
$$;
