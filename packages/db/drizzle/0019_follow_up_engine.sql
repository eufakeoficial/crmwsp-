-- Follow-up engine (T5): rule/dedupe/order/body columns on follow_ups (RLS already enabled in 0014).
-- Composite nullable FK uses ON DELETE SET NULL (col) (edited by hand, as in 0013).
CREATE TYPE "public"."follow_up_rule" AS ENUM('manual', 'lead_stalled', 'order_pending_payment');--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "rule" "follow_up_rule" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "message_body" text;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE SET NULL ("order_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follow_ups_tenant_conversation_status_idx" ON "follow_ups" USING btree ("tenant_id","conversation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_tenant_dedupe_key_unique" ON "follow_ups" USING btree ("tenant_id","dedupe_key") WHERE "follow_ups"."dedupe_key" IS NOT NULL;;--> statement-breakpoint

-- Scheduler tenant enumeration. The worker runs as crmwsp_app under FORCE RLS and cannot list
-- tenants; this SECURITY DEFINER function (owned by the migrator, same pattern as
-- resolve_payment_webhook in 0018) returns ONLY the ids of active tenants. Every read/write of
-- follow-ups afterwards happens inside withTenant(tenant_id). No set_config.
CREATE FUNCTION public."follow_up_tenant_ids"()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT t."id" FROM public."tenants" t WHERE t."status" = 'active' ORDER BY t."id";
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."follow_up_tenant_ids"() FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."follow_up_tenant_ids"() TO crmwsp_app;
  END IF;
END
$$;
