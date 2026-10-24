-- Trial anti-abuse (ADR 0015, T7): one phone number (or WABA) gets one free trial for life across
-- all tenants. trial_claims is PLATFORM-LEVEL (not tenant scoped): RLS forced with no policy and
-- no table privilege for the app role, like platform_admins (0052). Only the SECURITY DEFINER
-- functions below touch it. Identities are HMAC-SHA256 digests (TRIAL_IDENTITY_SECRET), never
-- the plaintext phone or WABA id.
CREATE TABLE public."trial_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "identity_type" text NOT NULL,
  "identity_hash" text NOT NULL,
  "first_tenant_id" uuid REFERENCES public."tenants"("id") ON DELETE SET NULL,
  "claimed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "trial_claims_identity_unique" UNIQUE ("identity_type", "identity_hash"),
  CONSTRAINT "trial_claims_type_check" CHECK ("identity_type" IN ('phone', 'waba')),
  CONSTRAINT "trial_claims_hash_check" CHECK ("identity_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
ALTER TABLE public."trial_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."trial_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Signup signals for the platform backoffice "posible multicuenta" flag (never blocks).
CREATE TABLE public."tenant_signup_signals" (
  "tenant_id" uuid PRIMARY KEY REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "signup_ip" inet,
  "email_normalized" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "tenant_signup_signals_ip_idx" ON public."tenant_signup_signals" ("signup_ip", "created_at");--> statement-breakpoint
CREATE INDEX "tenant_signup_signals_email_idx" ON public."tenant_signup_signals" ("email_normalized", "created_at");--> statement-breakpoint
ALTER TABLE public."tenant_signup_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."tenant_signup_signals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON TABLE public."trial_claims" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public."tenant_signup_signals" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."trial_claims" FROM crmwsp_app;
    REVOKE ALL ON TABLE public."tenant_signup_signals" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE public."tenant_plans" ADD COLUMN "trial_denied_at" timestamptz;--> statement-breakpoint
ALTER TABLE public."channel_connections" ADD COLUMN "trial_identity_claimed_at" timestamptz;--> statement-breakpoint

-- Claims 'type:hash' identities for p_tenant (first claimer wins). Returns true when ANY of them
-- was already claimed by another tenant. Invalid entries raise 22023.
CREATE FUNCTION public."trial_claims_insert_internal"(p_tenant uuid, p_identities text[])
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_ident text;
  v_type text;
  v_hash text;
  v_taken boolean := false;
BEGIN
  -- Fixed lock order (sorted) so two tenants claiming overlapping identities cannot deadlock;
  -- the lock makes check-then-insert race-safe.
  FOR v_ident IN SELECT DISTINCT x FROM pg_catalog.unnest(coalesce(p_identities, '{}'::text[])) AS x ORDER BY 1 LOOP
    v_type := pg_catalog.split_part(v_ident, ':', 1);
    v_hash := pg_catalog.split_part(v_ident, ':', 2);
    IF v_type NOT IN ('phone', 'waba') OR v_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'trial claims: invalid identity' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('trial-claim:' || v_ident, 0));
    IF EXISTS (SELECT 1 FROM public."trial_claims" c WHERE c."identity_type" = v_type AND c."identity_hash" = v_hash
               AND c."first_tenant_id" IS DISTINCT FROM p_tenant) THEN
      v_taken := true;
    END IF;
    INSERT INTO public."trial_claims" ("identity_type", "identity_hash", "first_tenant_id")
    VALUES (v_type, v_hash, p_tenant)
    ON CONFLICT ("identity_type", "identity_hash") DO NOTHING;
  END LOOP;
  RETURN v_taken;
END
$fn$;--> statement-breakpoint

DROP FUNCTION public."tenant_trial_start"();--> statement-breakpoint

-- Called in the transaction that made a channel of the CURRENT tenant active. Claims the
-- channel's identities and, when the tenant is in setup, starts the trial or, if any identity
-- was already claimed by another tenant, denies it (trial_denied_at = payment required).
-- Returns 'started' | 'denied' | 'ineligible'.
CREATE FUNCTION public."tenant_trial_start"(p_channel_id uuid, p_identities text[])
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_taken boolean := false;
  tp public."tenant_plans"%ROWTYPE;
BEGIN
  IF v_tenant IS NULL OR p_channel_id IS NULL THEN
    RAISE EXCEPTION 'tenant_trial_start: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."channel_connections" c
                 WHERE c."id" = p_channel_id AND c."tenant_id" = v_tenant AND c."status" = 'active') THEN
    RETURN 'ineligible';
  END IF;
  IF pg_catalog.cardinality(coalesce(p_identities, '{}'::text[])) > 0 THEN
    v_taken := public."trial_claims_insert_internal"(v_tenant, p_identities);
    UPDATE public."channel_connections" c SET "trial_identity_claimed_at" = pg_catalog.now()
    WHERE c."id" = p_channel_id AND c."trial_identity_claimed_at" IS NULL;
  END IF;
  SELECT * INTO tp FROM public."tenant_plans" t WHERE t."tenant_id" = v_tenant FOR UPDATE;
  IF NOT FOUND OR tp."setup_ends_at" IS NULL OR tp."trial_started_at" IS NOT NULL OR tp."trial_denied_at" IS NOT NULL
     OR pg_catalog.now() >= tp."setup_ends_at" THEN
    RETURN 'ineligible';
  END IF;
  IF v_taken THEN
    UPDATE public."tenant_plans" t SET "trial_denied_at" = pg_catalog.now(), "updated_at" = pg_catalog.now() WHERE t."id" = tp."id";
    RETURN 'denied';
  END IF;
  UPDATE public."tenant_plans" t
  SET "trial_started_at" = pg_catalog.now(), "trial_ends_at" = pg_catalog.now() + interval '7 days', "updated_at" = pg_catalog.now()
  WHERE t."id" = tp."id";
  RETURN 'started';
END
$fn$;--> statement-breakpoint

-- Worker backfill: active channels whose identity was never claimed (grandfathered tenants, or
-- servers without TRIAL_IDENTITY_SECRET at the time). Cross-tenant by design (system job).
CREATE FUNCTION public."trial_claims_pending_channels"(p_limit integer)
RETURNS TABLE (channel_id uuid, tenant_id uuid, phone_e164 text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT c."id", c."tenant_id", c."phone_e164" FROM public."channel_connections" c
  WHERE c."status" = 'active' AND c."trial_identity_claimed_at" IS NULL
  ORDER BY c."created_at", c."id"
  LIMIT LEAST(GREATEST(coalesce(p_limit, 100), 1), 500);
$fn$;--> statement-breakpoint

-- Worker backfill: records the claims of one channel without changing the tenant's state.
CREATE FUNCTION public."trial_claims_record"(p_channel_id uuid, p_identities text[])
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT c."tenant_id" INTO v_tenant FROM public."channel_connections" c
  WHERE c."id" = p_channel_id AND c."trial_identity_claimed_at" IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM public."trial_claims_insert_internal"(v_tenant, p_identities);
  UPDATE public."channel_connections" c SET "trial_identity_claimed_at" = pg_catalog.now() WHERE c."id" = p_channel_id;
  RETURN true;
END
$fn$;--> statement-breakpoint

-- Signup: stores the signals of a tenant created in the last 10 minutes, once.
CREATE FUNCTION public."tenant_signup_signals_record"(p_tenant_id uuid, p_ip inet, p_email_normalized text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF p_email_normalized IS NOT NULL AND pg_catalog.length(p_email_normalized) > 320 THEN
    RAISE EXCEPTION 'signup signals: invalid argument' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."tenant_signup_signals" ("tenant_id", "signup_ip", "email_normalized")
  SELECT t."id", p_ip, p_email_normalized FROM public."tenants" t
  WHERE t."id" = p_tenant_id AND t."created_at" > pg_catalog.now() - interval '10 minutes'
  ON CONFLICT ("tenant_id") DO NOTHING;
END
$fn$;--> statement-breakpoint

-- Platform: tenants sharing a signup IP or normalized email with more than p_threshold tenants
-- created in the last 30 days. A flag only, never a block.
CREATE FUNCTION public."platform_multiaccount_suspects"(p_actor uuid, p_threshold integer)
RETURNS TABLE (tenant_id uuid, same_ip integer, same_email integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
  WITH recent AS (
    SELECT s."tenant_id", s."signup_ip", s."email_normalized" FROM public."tenant_signup_signals" s
    WHERE s."created_at" > pg_catalog.now() - interval '30 days'
  ), counted AS (
    SELECT r."tenant_id",
           (SELECT pg_catalog.count(*) FROM recent x WHERE r."signup_ip" IS NOT NULL AND x."signup_ip" = r."signup_ip")::integer AS ip_n,
           (SELECT pg_catalog.count(*) FROM recent x WHERE r."email_normalized" IS NOT NULL AND x."email_normalized" = r."email_normalized")::integer AS em_n
    FROM recent r
  )
  SELECT c."tenant_id", c.ip_n, c.em_n FROM counted c
  WHERE c.ip_n > GREATEST(coalesce(p_threshold, 2), 1) OR c.em_n > GREATEST(coalesce(p_threshold, 2), 1);
END
$fn$;--> statement-breakpoint

-- Platform: grant a trial anyway (number already used one, or setup expired). Audited.
CREATE FUNCTION public."platform_grant_trial"(p_actor uuid, p_tenant_id uuid, p_ip inet)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  tp public."tenant_plans"%ROWTYPE;
  v_end timestamptz := pg_catalog.now() + interval '7 days';
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  SELECT * INTO tp FROM public."tenant_plans" t WHERE t."tenant_id" = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR tp."setup_ends_at" IS NULL THEN
    RAISE EXCEPTION 'platform: tenant has no trial lifecycle' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public."tenant_plans" t
  SET "trial_denied_at" = NULL, "trial_started_at" = pg_catalog.now(), "trial_ends_at" = v_end, "updated_at" = pg_catalog.now()
  WHERE t."id" = tp."id";
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'tenant.trial_granted', p_tenant_id,
          pg_catalog.jsonb_build_object('wasDenied', tp."trial_denied_at" IS NOT NULL, 'previousTrialEnd', tp."trial_ends_at", 'to', v_end), p_ip);
  RETURN v_end;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."trial_claims_insert_internal"(uuid, text[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_trial_start"(uuid, text[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."trial_claims_pending_channels"(integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."trial_claims_record"(uuid, text[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_signup_signals_record"(uuid, inet, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_multiaccount_suspects"(uuid, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_grant_trial"(uuid, uuid, inet) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."tenant_trial_start"(uuid, text[]) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."trial_claims_pending_channels"(integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."trial_claims_record"(uuid, text[]) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."tenant_signup_signals_record"(uuid, inet, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_multiaccount_suspects"(uuid, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_grant_trial"(uuid, uuid, inet) TO crmwsp_app;
  END IF;
END
$$;
