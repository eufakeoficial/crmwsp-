-- Referral program (ADR 0017). All three tables are PLATFORM-LEVEL: RLS forced with no policy and
-- no privilege for crmwsp_app; tenants reach them only through the SECURITY DEFINER functions
-- below, which act on the CURRENT tenant (app.tenant_id) and never expose another tenant's data.
-- A referrer earns one credit (20% off one monthly charge, stackable to 100%) when the referred
-- tenant's FIRST provider charge settles as paid, unless the T7 anti-abuse signals match.

CREATE TABLE public."tenant_referral_codes" (
  "tenant_id" uuid PRIMARY KEY REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_referral_codes_code_unique" UNIQUE ("code"),
  CONSTRAINT "tenant_referral_codes_code_check" CHECK ("code" ~ '^[A-Z0-9]{8}$')
);--> statement-breakpoint

CREATE TABLE public."tenant_referrals" (
  "referred_tenant_id" uuid PRIMARY KEY REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "referrer_tenant_id" uuid NOT NULL REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "reject_reason" text,
  "charge_id" uuid REFERENCES public."subscription_charges"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz,
  CONSTRAINT "tenant_referrals_not_self" CHECK ("referred_tenant_id" <> "referrer_tenant_id"),
  CONSTRAINT "tenant_referrals_status_check" CHECK ("status" IN ('pending', 'rewarded', 'rejected', 'revoked')),
  CONSTRAINT "tenant_referrals_reason_check" CHECK ("reject_reason" IS NULL OR "reject_reason" IN ('same_email', 'same_ip', 'trial_reused', 'refunded'))
);--> statement-breakpoint
CREATE INDEX "tenant_referrals_referrer_idx" ON public."tenant_referrals" ("referrer_tenant_id", "status");--> statement-breakpoint

CREATE TABLE public."referral_rewards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "referred_tenant_id" uuid NOT NULL REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "percent" integer NOT NULL DEFAULT 20,
  "status" text NOT NULL DEFAULT 'available',
  "held_by_charge_id" uuid REFERENCES public."subscription_charges"("id") ON DELETE SET NULL,
  "consumed_charge_id" uuid REFERENCES public."subscription_charges"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- Idempotent per referred tenant: one reward for life.
  CONSTRAINT "referral_rewards_referred_unique" UNIQUE ("referred_tenant_id"),
  CONSTRAINT "referral_rewards_percent_check" CHECK ("percent" = 20),
  CONSTRAINT "referral_rewards_status_check" CHECK ("status" IN ('available', 'consumed', 'revoked'))
);--> statement-breakpoint
CREATE INDEX "referral_rewards_tenant_idx" ON public."referral_rewards" ("tenant_id", "status", "created_at");--> statement-breakpoint

ALTER TABLE public."tenant_referral_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."tenant_referral_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."tenant_referrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."tenant_referrals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."referral_rewards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."referral_rewards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public."tenant_referral_codes" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public."tenant_referrals" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public."referral_rewards" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."tenant_referral_codes" FROM crmwsp_app;
    REVOKE ALL ON TABLE public."tenant_referrals" FROM crmwsp_app;
    REVOKE ALL ON TABLE public."referral_rewards" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Referral code of the CURRENT tenant, created on first use (8 chars, A-Z0-9).
CREATE FUNCTION public."tenant_referral_code"()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_code text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant_referral_code: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT c."code" INTO v_code FROM public."tenant_referral_codes" c WHERE c."tenant_id" = v_tenant;
  WHILE v_code IS NULL LOOP
    v_code := pg_catalog.upper(pg_catalog.substr(pg_catalog.md5(gen_random_uuid()::text), 1, 8));
    BEGIN
      INSERT INTO public."tenant_referral_codes" ("tenant_id", "code") VALUES (v_tenant, v_code)
      ON CONFLICT ("tenant_id") DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      v_code := NULL; -- code collision: retry
      CONTINUE;
    END;
    SELECT c."code" INTO v_code FROM public."tenant_referral_codes" c WHERE c."tenant_id" = v_tenant;
  END LOOP;
  RETURN v_code;
END
$fn$;--> statement-breakpoint

-- Signup: stores who referred a tenant created in the last 10 minutes, once. Unknown code or a
-- code of the same tenant: ignored (returns false). Never blocks the signup.
CREATE FUNCTION public."tenant_referral_record"(p_tenant_id uuid, p_code text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_referrer uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_code IS NULL OR pg_catalog.length(p_code) > 32 THEN
    RETURN false;
  END IF;
  SELECT c."tenant_id" INTO v_referrer FROM public."tenant_referral_codes" c WHERE c."code" = pg_catalog.upper(pg_catalog.btrim(p_code));
  IF v_referrer IS NULL OR v_referrer = p_tenant_id THEN
    RETURN false;
  END IF;
  INSERT INTO public."tenant_referrals" ("referred_tenant_id", "referrer_tenant_id")
  SELECT t."id", v_referrer FROM public."tenants" t
  WHERE t."id" = p_tenant_id AND t."created_at" > pg_catalog.now() - interval '10 minutes'
  ON CONFLICT ("referred_tenant_id") DO NOTHING;
  RETURN FOUND;
END
$fn$;--> statement-breakpoint

-- Credits of p_tenant usable now: available and not held by a live (pending, < 24 h) charge.
CREATE FUNCTION public."referral_credits_free_internal"(p_tenant uuid)
RETURNS SETOF public."referral_rewards"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT r.* FROM public."referral_rewards" r
  LEFT JOIN public."subscription_charges" s ON s."id" = r."held_by_charge_id"
  WHERE r."tenant_id" = p_tenant AND r."status" = 'available'
    AND (s."id" IS NULL OR s."status" <> 'pending' OR s."created_at" <= pg_catalog.now() - interval '24 hours')
  ORDER BY r."created_at", r."id";
$fn$;--> statement-breakpoint

CREATE FUNCTION public."tenant_referral_credits_available"()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT pg_catalog.count(*)::integer
  FROM public."referral_credits_free_internal"(NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid);
$fn$;--> statement-breakpoint

-- Monthly pending charge discounted by up to 5 credits (20% each) of the CURRENT tenant. The
-- credits are held by the charge and consumed when it settles as paid.
CREATE FUNCTION public."subscription_charge_create_with_referral"(p_plan text, p_list_price numeric, p_pay_currency text, p_created_by uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_ids uuid[];
  v_n integer;
  v_discount numeric;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL OR p_plan IS NULL OR p_plan NOT IN ('start', 'pro')
     OR p_list_price IS NULL OR p_list_price <= 0 OR p_list_price > 1000000
     OR p_pay_currency IS NULL OR p_pay_currency !~ '^[a-z0-9]{2,20}$' THEN
    RAISE EXCEPTION 'subscription_charge_create_with_referral: invalid argument' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('referral-credits:' || v_tenant::text, 0));
  SELECT pg_catalog.array_agg(x."id") INTO v_ids FROM (SELECT f."id" FROM public."referral_credits_free_internal"(v_tenant) f LIMIT 5) x;
  v_n := coalesce(pg_catalog.cardinality(v_ids), 0);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'coupon: no_credits' USING ERRCODE = '22023';
  END IF;
  v_discount := public."coupon_discount_internal"('percent', v_n * 20, p_list_price);
  IF v_discount >= p_list_price THEN
    RAISE EXCEPTION 'coupon: free' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."subscription_charges"
    ("tenant_id", "plan", "price_amount", "price_currency", "pay_currency", "created_by", "period_days",
     "list_price_amount", "discount_amount", "referral_credits")
  VALUES (v_tenant, p_plan, p_list_price - v_discount, 'usd', p_pay_currency, p_created_by, 30, p_list_price, v_discount, v_n)
  RETURNING "id" INTO v_id;
  UPDATE public."referral_rewards" r SET "held_by_charge_id" = v_id, "updated_at" = pg_catalog.now() WHERE r."id" = ANY (v_ids);
  RETURN v_id;
END
$fn$;--> statement-breakpoint

-- One free month (5 credits = 100%) for the CURRENT tenant. Idempotent for 2 minutes.
CREATE FUNCTION public."subscription_referral_grant"(p_plan text, p_list_price numeric, p_created_by uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_ids uuid[];
  v_id uuid;
BEGIN
  IF v_tenant IS NULL OR p_plan IS NULL OR p_plan NOT IN ('start', 'pro')
     OR p_list_price IS NULL OR p_list_price <= 0 OR p_list_price > 1000000 THEN
    RAISE EXCEPTION 'subscription_referral_grant: invalid argument' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('referral-credits:' || v_tenant::text, 0));
  SELECT s."id" INTO v_id FROM public."subscription_charges" s
  WHERE s."tenant_id" = v_tenant AND s."verified_by" = 'coupon' AND s."coupon_id" IS NULL AND s."referral_credits" > 0
    AND s."created_at" > pg_catalog.now() - interval '2 minutes'
  ORDER BY s."created_at" DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT pg_catalog.array_agg(x."id") INTO v_ids FROM (SELECT f."id" FROM public."referral_credits_free_internal"(v_tenant) f LIMIT 5) x;
  IF coalesce(pg_catalog.cardinality(v_ids), 0) < 5 THEN
    RAISE EXCEPTION 'coupon: not_free' USING ERRCODE = '22023';
  END IF;
  v_id := public."subscription_free_period_internal"(v_tenant, p_plan, 30, p_list_price, p_list_price, NULL, NULL, 5, p_created_by);
  UPDATE public."referral_rewards" r
  SET "status" = 'consumed', "consumed_charge_id" = v_id, "held_by_charge_id" = v_id, "updated_at" = pg_catalog.now()
  WHERE r."id" = ANY (v_ids);
  RETURN v_id;
END
$fn$;--> statement-breakpoint

-- Decides the referral reward of p_tenant (the REFERRED tenant) after its first provider charge
-- settled as paid. Idempotent: only a pending referral is decided; one reward per referred tenant.
CREATE FUNCTION public."referral_decide_internal"(p_tenant uuid, p_charge uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  ref public."tenant_referrals"%ROWTYPE;
  a public."tenant_signup_signals"%ROWTYPE;
  b public."tenant_signup_signals"%ROWTYPE;
  v_reason text;
BEGIN
  SELECT * INTO ref FROM public."tenant_referrals" r WHERE r."referred_tenant_id" = p_tenant AND r."status" = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- FIRST provider charge only (coupon grants are not charges paid with money).
  IF (SELECT pg_catalog.count(*) FROM public."subscription_charges" s
      WHERE s."tenant_id" = p_tenant AND s."status" IN ('paid', 'refunded') AND s."verified_by" IN ('webhook', 'reconciliation')) <> 1 THEN
    RETURN;
  END IF;
  SELECT * INTO a FROM public."tenant_signup_signals" x WHERE x."tenant_id" = p_tenant;
  SELECT * INTO b FROM public."tenant_signup_signals" x WHERE x."tenant_id" = ref."referrer_tenant_id";
  IF a."email_normalized" IS NOT NULL AND a."email_normalized" = b."email_normalized" THEN
    v_reason := 'same_email';
  ELSIF a."signup_ip" IS NOT NULL AND a."signup_ip" = b."signup_ip" THEN
    v_reason := 'same_ip';
  ELSIF EXISTS (SELECT 1 FROM public."tenant_plans" tp WHERE tp."tenant_id" = p_tenant AND tp."trial_denied_at" IS NOT NULL) THEN
    v_reason := 'trial_reused';
  END IF;
  IF v_reason IS NOT NULL THEN
    UPDATE public."tenant_referrals" r SET "status" = 'rejected', "reject_reason" = v_reason, "charge_id" = p_charge, "decided_at" = pg_catalog.now()
    WHERE r."referred_tenant_id" = p_tenant;
    INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
    VALUES (NULL, 'referral.rejected', ref."referrer_tenant_id", pg_catalog.jsonb_build_object('referredTenantId', p_tenant, 'reason', v_reason));
    RETURN;
  END IF;
  INSERT INTO public."referral_rewards" ("tenant_id", "referred_tenant_id") VALUES (ref."referrer_tenant_id", p_tenant)
  ON CONFLICT ("referred_tenant_id") DO NOTHING;
  UPDATE public."tenant_referrals" r SET "status" = 'rewarded', "charge_id" = p_charge, "decided_at" = pg_catalog.now()
  WHERE r."referred_tenant_id" = p_tenant;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
  VALUES (NULL, 'referral.rewarded', ref."referrer_tenant_id", pg_catalog.jsonb_build_object('referredTenantId', p_tenant, 'chargeId', p_charge));
END
$fn$;--> statement-breakpoint

-- 0071 hook + referral credits consumption + referral reward of the referred tenant.
CREATE OR REPLACE FUNCTION public."subscription_charge_paid_hook_internal"(p_charge uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  s public."subscription_charges"%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public."subscription_charges" x WHERE x."id" = p_charge;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF s."coupon_id" IS NOT NULL THEN
    PERFORM 1 FROM public."coupons" c WHERE c."id" = s."coupon_id" FOR UPDATE;
    INSERT INTO public."coupon_redemptions" ("tenant_id", "coupon_id", "charge_id", "discount_amount")
    VALUES (s."tenant_id", s."coupon_id", s."id", s."discount_amount")
    ON CONFLICT ("charge_id") DO NOTHING;
  END IF;
  IF s."referral_credits" > 0 THEN
    UPDATE public."referral_rewards" r
    SET "status" = 'consumed', "consumed_charge_id" = s."id", "updated_at" = pg_catalog.now()
    WHERE r."held_by_charge_id" = s."id" AND r."status" = 'available';
  END IF;
  IF s."verified_by" IN ('webhook', 'reconciliation') THEN
    PERFORM public."referral_decide_internal"(s."tenant_id", s."id");
  END IF;
END
$fn$;--> statement-breakpoint

-- Refund of the referred tenant's rewarding charge revokes the reward if not used yet.
CREATE OR REPLACE FUNCTION public."subscription_charge_refund_hook_internal"(p_charge uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  ref public."tenant_referrals"%ROWTYPE;
BEGIN
  SELECT * INTO ref FROM public."tenant_referrals" r WHERE r."charge_id" = p_charge AND r."status" = 'rewarded' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public."referral_rewards" w SET "status" = 'revoked', "updated_at" = pg_catalog.now()
  WHERE w."referred_tenant_id" = ref."referred_tenant_id" AND w."status" = 'available';
  UPDATE public."tenant_referrals" r SET "status" = 'revoked', "reject_reason" = 'refunded', "decided_at" = pg_catalog.now()
  WHERE r."referred_tenant_id" = ref."referred_tenant_id";
END
$fn$;--> statement-breakpoint

-- Referral summary of the CURRENT tenant (counts only, never other tenants' names).
CREATE FUNCTION public."tenant_referral_summary"()
RETURNS TABLE (code text, referred integer, pending integer, rewarded integer, rejected integer, credits_available integer, credits_used integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant_referral_summary: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT
    public."tenant_referral_code"(),
    (SELECT pg_catalog.count(*) FROM public."tenant_referrals" r WHERE r."referrer_tenant_id" = v_tenant)::integer,
    (SELECT pg_catalog.count(*) FROM public."tenant_referrals" r WHERE r."referrer_tenant_id" = v_tenant AND r."status" = 'pending')::integer,
    (SELECT pg_catalog.count(*) FROM public."tenant_referrals" r WHERE r."referrer_tenant_id" = v_tenant AND r."status" = 'rewarded')::integer,
    (SELECT pg_catalog.count(*) FROM public."tenant_referrals" r WHERE r."referrer_tenant_id" = v_tenant AND r."status" IN ('rejected', 'revoked'))::integer,
    (SELECT pg_catalog.count(*) FROM public."referral_credits_free_internal"(v_tenant))::integer,
    (SELECT pg_catalog.count(*) FROM public."referral_rewards" w WHERE w."tenant_id" = v_tenant AND w."status" = 'consumed')::integer;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."tenant_referral_code"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_referral_record"(uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."referral_credits_free_internal"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_referral_credits_available"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_charge_create_with_referral"(text, numeric, text, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_referral_grant"(text, numeric, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."referral_decide_internal"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_referral_summary"() FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."tenant_referral_code"() TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."tenant_referral_record"(uuid, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."tenant_referral_credits_available"() TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."subscription_charge_create_with_referral"(text, numeric, text, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."subscription_referral_grant"(text, numeric, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."tenant_referral_summary"() TO crmwsp_app;
  END IF;
END
$$;
