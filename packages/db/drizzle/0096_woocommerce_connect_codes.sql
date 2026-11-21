-- WooCommerce "connect code" (odd/tasks/woocommerce-plugin.md, T1).
--  * integration_connect_codes: single-use, hashed (SHA-256), short-lived (15 min default) codes an
--    owner/admin issues in the panel and pastes into the WordPress plugin, which exchanges it (public
--    endpoint) for a commerce connection. SYSTEM-ONLY table: RLS forced, only the owner policy, no
--    privilege for crmwsp_app; access goes through the SECURITY DEFINER functions below (same model
--    as email_verification_tokens, 0095).
--  * Issuing requires the caller's transaction context to be that tenant (app.tenant_id, like 0094).
--  * Consuming re-checks that the tenant is active and the issuer is still owner/admin of it.

CREATE TABLE public."integration_connect_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'woocommerce',
  "code_hash" bytea NOT NULL,
  "created_by" uuid NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integration_connect_codes_code_hash_unique" UNIQUE ("code_hash"),
  CONSTRAINT "integration_connect_codes_code_hash_len_check" CHECK (octet_length("code_hash") = 32),
  CONSTRAINT "integration_connect_codes_provider_check" CHECK ("provider" IN ('woocommerce'))
);--> statement-breakpoint
CREATE INDEX "integration_connect_codes_tenant_idx" ON public."integration_connect_codes" ("tenant_id", "provider", "created_at");--> statement-breakpoint

ALTER TABLE public."integration_connect_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."integration_connect_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public."integration_connect_codes" FROM PUBLIC;--> statement-breakpoint
DO $$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = 'public.integration_connect_codes'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public.integration_connect_codes AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."integration_connect_codes" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Issues a connect code for the caller's tenant: voids the tenant's unused codes for the provider and
-- stores the new hash. Returns the expiry, or no row (no/other tenant context, inactive tenant, bad
-- arguments).
CREATE FUNCTION public."connect_code_issue"(p_tenant_id uuid, p_user_id uuid, p_hash bytea, p_ttl_seconds integer DEFAULT 900)
RETURNS TABLE (expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_expires timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR v_ctx <> p_tenant_id OR p_user_id IS NULL
     OR p_hash IS NULL OR octet_length(p_hash) <> 32 THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."tenants" t WHERE t."id" = p_tenant_id AND t."status" = 'active') THEN
    RETURN;
  END IF;
  UPDATE public."integration_connect_codes" c SET "used_at" = pg_catalog.now()
  WHERE c."tenant_id" = p_tenant_id AND c."provider" = 'woocommerce' AND c."used_at" IS NULL;
  v_expires := pg_catalog.now() + pg_catalog.make_interval(secs => LEAST(GREATEST(coalesce(p_ttl_seconds, 900), 60), 3600));
  INSERT INTO public."integration_connect_codes" ("tenant_id", "provider", "code_hash", "created_by", "expires_at")
  VALUES (p_tenant_id, 'woocommerce', p_hash, p_user_id, v_expires);
  RETURN QUERY SELECT v_expires;
END
$fn$;--> statement-breakpoint

-- Consumes a connect code (single use, unexpired, active tenant, issuer still owner/admin). Returns
-- the tenant, the issuer and the tenant name, or no row for an unknown/used/expired code.
CREATE FUNCTION public."connect_code_consume"(p_hash bytea)
RETURNS TABLE (tenant_id uuid, created_by uuid, tenant_name text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_tenant uuid;
  v_user uuid;
BEGIN
  IF p_hash IS NULL OR octet_length(p_hash) <> 32 THEN
    RETURN;
  END IF;
  SELECT c."id", c."tenant_id", c."created_by" INTO v_id, v_tenant, v_user FROM public."integration_connect_codes" c
  WHERE c."code_hash" = p_hash AND c."used_at" IS NULL AND c."expires_at" > pg_catalog.now()
  FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN;
  END IF;
  -- Burned even when the checks below fail: a code is never retried.
  UPDATE public."integration_connect_codes" SET "used_at" = pg_catalog.now() WHERE "id" = v_id;
  IF NOT EXISTS (SELECT 1 FROM public."tenants" t WHERE t."id" = v_tenant AND t."status" = 'active') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."memberships" m
    WHERE m."tenant_id" = v_tenant AND m."user_id" = v_user AND m."role" IN ('owner', 'admin')
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT v_tenant, v_user, t."name" FROM public."tenants" t WHERE t."id" = v_tenant;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."connect_code_issue"(uuid, uuid, bytea, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."connect_code_consume"(bytea) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."connect_code_issue"(uuid, uuid, bytea, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."connect_code_consume"(bytea) TO crmwsp_app;
  END IF;
END
$$;
