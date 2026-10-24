-- Defense in depth for SECURITY DEFINER functions that trusted their arguments
-- (odd/tasks/fix-prelanzamiento.md, F8).
--  1) List price: subscription_charge_create / _with_coupon / _with_referral / subscription_coupon_grant
--     received the list price from the API. A trigger now verifies, for every charge of a 30/365-day
--     period, that the list price (list_price_amount, or price_amount when there is no discount) is
--     the plan's list price. Keep in sync with PLANS in @crmwsp/billing (a db test checks it): a
--     price change needs a migration here. Coupon free-days grants (other periods) are not checked.
--  2) tenant_referral_record / tenant_signup_signals_record now require the caller's transaction
--     context to be that tenant (app.tenant_id = p_tenant_id); the API calls them under withTenant
--     right after signup. Without context they do nothing (same as an unknown tenant).

CREATE FUNCTION public."subscription_plan_list_price"(p_plan text, p_period_days integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_plan = 'start' AND p_period_days = 30 THEN 49.00
    WHEN p_plan = 'start' AND p_period_days = 365 THEN 490.00
    WHEN p_plan = 'pro' AND p_period_days = 30 THEN 89.00
    WHEN p_plan = 'pro' AND p_period_days = 365 THEN 890.00
  END::numeric;
$fn$;--> statement-breakpoint

CREATE FUNCTION public."subscription_charges_list_price_check"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_expected numeric;
BEGIN
  IF NEW."period_days" NOT IN (30, 365) THEN
    RETURN NEW;
  END IF;
  v_expected := public."subscription_plan_list_price"(NEW."plan"::text, NEW."period_days");
  IF v_expected IS NULL OR coalesce(NEW."list_price_amount", NEW."price_amount") <> v_expected THEN
    RAISE EXCEPTION 'subscription_charge: list price mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint

CREATE TRIGGER "subscription_charges_list_price_check"
BEFORE INSERT ON public."subscription_charges"
FOR EACH ROW EXECUTE FUNCTION public."subscription_charges_list_price_check"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public."tenant_referral_record"(p_tenant_id uuid, p_code text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_referrer uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR v_ctx <> p_tenant_id OR p_code IS NULL OR pg_catalog.length(p_code) > 32 THEN
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

CREATE OR REPLACE FUNCTION public."tenant_signup_signals_record"(p_tenant_id uuid, p_ip inet, p_email_normalized text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF p_email_normalized IS NOT NULL AND pg_catalog.length(p_email_normalized) > 320 THEN
    RAISE EXCEPTION 'signup signals: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF v_ctx IS NULL OR v_ctx <> p_tenant_id THEN
    RETURN;
  END IF;
  INSERT INTO public."tenant_signup_signals" ("tenant_id", "signup_ip", "email_normalized")
  SELECT t."id", p_ip, p_email_normalized FROM public."tenants" t
  WHERE t."id" = p_tenant_id AND t."created_at" > pg_catalog.now() - interval '10 minutes'
  ON CONFLICT ("tenant_id") DO NOTHING;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."subscription_charges_list_price_check"() FROM PUBLIC;
