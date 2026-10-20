-- Row Level Security for the developer platform tables (ADR 0002), same conventions as 0022:
-- tenant_isolation for the app role, system_owner for the table owner.
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "api_keys"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_endpoints"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_deliveries"
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
  FOREACH t IN ARRAY ARRAY['api_keys', 'webhook_endpoints', 'webhook_deliveries']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
  END LOOP;
END
$$;--> statement-breakpoint

-- API keys are revoked, never deleted (audit trail); the delivery log is append + update only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE DELETE, TRUNCATE ON public."api_keys" FROM crmwsp_app;
    REVOKE TRUNCATE ON public."webhook_deliveries" FROM crmwsp_app;
    REVOKE TRUNCATE ON public."webhook_endpoints" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Public API authentication: resolves ONLY a non-revoked key by its SHA-256 hash, returning the
-- tenant, key id and scopes of an active tenant. No set_config; the caller then uses withTenant.
CREATE FUNCTION public."resolve_api_key"(p_key_hash bytea)
RETURNS TABLE (tenant_id uuid, api_key_id uuid, scopes text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF p_key_hash IS NULL OR pg_catalog.length(p_key_hash) <> 32 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT k."tenant_id", k."id", k."scopes"
    FROM public."api_keys" k
    JOIN public."tenants" t ON t."id" = k."tenant_id"
    WHERE k."key_hash" = p_key_hash AND k."revoked_at" IS NULL AND t."status" = 'active';
END
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."resolve_api_key"(bytea) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."resolve_api_key"(bytea) TO crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Webhook delivery tick enumeration (same pattern as notification_tenant_ids in 0020): ONLY the
-- ids of active tenants with due pending deliveries. Everything else runs inside withTenant.
CREATE FUNCTION public."webhook_delivery_tenant_ids"()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT DISTINCT d."tenant_id" FROM public."webhook_deliveries" d
  JOIN public."tenants" t ON t."id" = d."tenant_id"
  WHERE d."status" = 'pending' AND d."next_attempt_at" <= now() AND t."status" = 'active'
  ORDER BY d."tenant_id";
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."webhook_delivery_tenant_ids"() FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."webhook_delivery_tenant_ids"() TO crmwsp_app;
  END IF;
END
$$;
