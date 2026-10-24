-- 360dialog Connect hardening (odd/tasks/fix-prelanzamiento.md, F1).
--  * channel_connect_states: server-issued, single-use, short-lived `state` that binds a Connect
--    redirect to the tenant + user that started it. Only the SHA-256 hash is stored.
--  * channel_external_owned_elsewhere: cross-tenant ownership probe. RLS hides other tenants'
--    channel_connections, so without it a tenant could mint a new API key (revoking the one in use)
--    for a channel id that belongs to someone else. It returns only the ids, never the owner.
-- SYSTEM-ONLY table like 0074: RLS forced, owner policy only, no privilege for crmwsp_app. Every
-- function reads the tenant/user from the transaction context (app.tenant_id / app.user_id), never
-- from arguments.

CREATE TABLE public."channel_connect_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "state_hash" bytea NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  CONSTRAINT "channel_connect_states_hash_unique" UNIQUE ("state_hash"),
  CONSTRAINT "channel_connect_states_hash_len_check" CHECK (octet_length("state_hash") = 32),
  CONSTRAINT "channel_connect_states_provider_check" CHECK ("provider" IN ('360dialog'))
);--> statement-breakpoint
CREATE INDEX "channel_connect_states_tenant_idx" ON public."channel_connect_states" ("tenant_id", "created_at");--> statement-breakpoint

ALTER TABLE public."channel_connect_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."channel_connect_states" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public."channel_connect_states" FROM PUBLIC;--> statement-breakpoint
DO $$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = 'public.channel_connect_states'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public."channel_connect_states" AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."channel_connect_states" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Issues a state for the CURRENT tenant + user. Returns its expiry, or NULL without context.
CREATE FUNCTION public."channel_connect_state_issue"(p_provider text, p_state_hash bytea, p_ttl_seconds integer)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_user uuid := NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;
  v_expires timestamptz;
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL OR p_state_hash IS NULL OR octet_length(p_state_hash) <> 32 THEN
    RETURN NULL;
  END IF;
  -- Housekeeping: drop this tenant's expired states.
  DELETE FROM public."channel_connect_states" s WHERE s."tenant_id" = v_tenant AND s."expires_at" < pg_catalog.now() - interval '1 day';
  v_expires := pg_catalog.now() + pg_catalog.make_interval(secs => LEAST(GREATEST(coalesce(p_ttl_seconds, 900), 60), 3600));
  INSERT INTO public."channel_connect_states" ("tenant_id", "user_id", "provider", "state_hash", "expires_at")
  VALUES (v_tenant, v_user, p_provider, p_state_hash, v_expires);
  RETURN v_expires;
END
$fn$;--> statement-breakpoint

-- Consumes a state: true only once, only for the tenant + user that issued it, only before expiry.
CREATE FUNCTION public."channel_connect_state_consume"(p_provider text, p_state_hash bytea)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_user uuid := NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid;
  v_count integer;
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL OR p_state_hash IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public."channel_connect_states" s SET "consumed_at" = pg_catalog.now()
  WHERE s."state_hash" = p_state_hash AND s."provider" = p_provider AND s."tenant_id" = v_tenant
    AND s."user_id" = v_user AND s."consumed_at" IS NULL AND s."expires_at" > pg_catalog.now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END
$fn$;--> statement-breakpoint

-- Read-only check (same rules as consume, without consuming): lets the API refuse early and still
-- allow a retry when it only needs more input (e.g. the phone number) before minting keys.
CREATE FUNCTION public."channel_connect_state_check"(p_provider text, p_state_hash bytea)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public."channel_connect_states" s
    WHERE s."state_hash" = p_state_hash AND s."provider" = p_provider
      AND s."tenant_id" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid
      AND s."user_id" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
      AND s."consumed_at" IS NULL AND s."expires_at" > pg_catalog.now()
  );
$fn$;--> statement-breakpoint

-- External channel ids (of one provider) that are already connected by ANOTHER tenant.
CREATE FUNCTION public."channel_external_owned_elsewhere"(p_provider text, p_external_ids text[])
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT DISTINCT c."external_app_id"
  FROM public."channel_connections" c
  WHERE NULLIF(pg_catalog.current_setting('app.tenant_id', true), '') IS NOT NULL
    AND c."provider"::text = p_provider
    AND c."external_app_id" = ANY (p_external_ids)
    AND c."tenant_id" <> NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid
  LIMIT 50;
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."channel_connect_state_issue"(text, bytea, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."channel_connect_state_consume"(text, bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."channel_connect_state_check"(text, bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."channel_external_owned_elsewhere"(text, text[]) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."channel_connect_state_issue"(text, bytea, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."channel_connect_state_consume"(text, bytea) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."channel_connect_state_check"(text, bytea) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."channel_external_owned_elsewhere"(text, text[]) TO crmwsp_app;
  END IF;
END
$$;
