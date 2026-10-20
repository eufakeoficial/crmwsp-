-- Row Level Security for the Meta Ads spend sync (T30), same conventions as 0028:
-- tenant_isolation, system_owner, and an ids-only SECURITY DEFINER for the sync tick.
ALTER TABLE "meta_ads_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_ads_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "meta_ads_connections"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "ad_spend_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_spend_daily" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ad_spend_daily"
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
  FOREACH t IN ARRAY ARRAY['meta_ads_connections', 'ad_spend_daily']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
  END LOOP;
END
$$;--> statement-breakpoint

-- Tenants the Meta Ads sync tick must visit (active tenant + active Meta Ads connection). Returns
-- ids only (no token, no account); every later read runs under withTenant / RLS. No set_config.
CREATE FUNCTION public."meta_ads_tenant_ids"()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT t."id" FROM public."tenants" t
  JOIN public."meta_ads_connections" m ON m."tenant_id" = t."id"
  WHERE t."status" = 'active' AND m."status" = 'active'
  ORDER BY t."id";
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."meta_ads_tenant_ids"() FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."meta_ads_tenant_ids"() TO crmwsp_app;
  END IF;
END
$$;
