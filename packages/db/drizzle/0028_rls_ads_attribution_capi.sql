-- Row Level Security for ad attribution, ad spend and the Meta Conversions API tables (ADR 0002),
-- same conventions as 0022: tenant_isolation, system_owner, and the sent-events log without
-- DELETE/TRUNCATE for the app role.
ALTER TABLE "ad_attributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_attributions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ad_attributions"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "ad_spend" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_spend" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ad_spend"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "meta_capi_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_capi_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "meta_capi_connections"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "capi_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "capi_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "capi_events"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_insert" ON "capi_events"
  FOR INSERT
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_update" ON "capi_events"
  FOR UPDATE
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
  FOREACH t IN ARRAY ARRAY['ad_attributions', 'ad_spend', 'meta_capi_connections', 'capi_events']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
  END LOOP;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE DELETE, TRUNCATE ON public."capi_events" FROM crmwsp_app;
    REVOKE DELETE, TRUNCATE ON public."ad_attributions" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Tenants the Conversions API tick must visit (active tenant + active Meta connection). Returns
-- ids only (no token, no dataset); every later read runs under withTenant / RLS. No set_config.
CREATE FUNCTION public."capi_tenant_ids"()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT t."id" FROM public."tenants" t
  JOIN public."meta_capi_connections" m ON m."tenant_id" = t."id"
  WHERE t."status" = 'active' AND m."status" = 'active'
  ORDER BY t."id";
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."capi_tenant_ids"() FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."capi_tenant_ids"() TO crmwsp_app;
  END IF;
END
$$;
