-- Row Level Security for the inbox v2 tables (ADR 0002), same conventions as 0022/0035.
-- The worker enumerates tenants with due reminders through reminder_tenant_ids() (SECURITY
-- DEFINER, ids only); every read/write is then made inside withTenant(tenant_id).
ALTER TABLE "conversation_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversation_notes"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "conversation_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_reminders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversation_reminders"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tags"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "canned_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "canned_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "canned_responses"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DO $$
DECLARE
  v_owner text;
  v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH v_table IN ARRAY ARRAY['conversation_notes', 'conversation_reminders', 'tags', 'canned_responses'] LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', v_table)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_table, v_owner);
  END LOOP;
END
$$;--> statement-breakpoint

CREATE FUNCTION public."reminder_tenant_ids"()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT DISTINCT r."tenant_id" FROM public."conversation_reminders" r
  JOIN public."tenants" t ON t."id" = r."tenant_id"
  WHERE r."done" = false AND r."notified_at" IS NULL AND r."remind_at" <= now() AND t."status" = 'active'
  ORDER BY r."tenant_id";
$fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public."reminder_tenant_ids"() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."reminder_tenant_ids"() TO crmwsp_app;
  END IF;
END
$$;
