-- Subscription coupons (ADR 0017). `coupons` is PLATFORM-LEVEL (created by platform admins, not
-- tenant scoped): RLS forced with no policy and no privilege for the app role, like trial_claims
-- (0069). Tenants only reach it through the SECURITY DEFINER functions below. coupon_redemptions
-- is tenant scoped (read-only for the app role, own tenant).
-- Charges now store list price, discount and coupon; price_amount stays the FINAL price.
-- Invariant (also enforced by decideSettlement): price_amount = list price - discount_amount.
-- A free period (100% discount, free_days) is a charge settled directly with verified_by='coupon',
-- price 0 and no provider payment; provider charges keep requiring webhook|reconciliation.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
END
$$;--> statement-breakpoint

CREATE TABLE public."coupons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "type" text NOT NULL,
  "value" numeric(12, 2) NOT NULL,
  "plans" text[] NOT NULL DEFAULT '{}'::text[],
  "period" text NOT NULL DEFAULT 'any',
  "max_redemptions" integer,
  "per_tenant_limit" integer NOT NULL DEFAULT 1,
  "valid_from" timestamptz,
  "valid_until" timestamptz,
  "active" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES public."users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "coupons_code_check" CHECK ("code" ~ '^[A-Z0-9_-]{3,32}$'),
  CONSTRAINT "coupons_type_check" CHECK ("type" IN ('percent', 'fixed_usd', 'free_days')),
  CONSTRAINT "coupons_value_check" CHECK (
    ("type" = 'percent' AND "value" = pg_catalog.trunc("value") AND "value" BETWEEN 1 AND 100)
    OR ("type" = 'fixed_usd' AND "value" > 0 AND "value" <= 100000)
    OR ("type" = 'free_days' AND "value" = pg_catalog.trunc("value") AND "value" BETWEEN 1 AND 365)),
  CONSTRAINT "coupons_plans_check" CHECK ("plans" <@ ARRAY['start', 'pro']::text[]),
  CONSTRAINT "coupons_period_check" CHECK ("period" IN ('monthly', 'annual', 'any')),
  CONSTRAINT "coupons_max_check" CHECK ("max_redemptions" IS NULL OR "max_redemptions" >= 1),
  CONSTRAINT "coupons_per_tenant_check" CHECK ("per_tenant_limit" BETWEEN 1 AND 1000),
  CONSTRAINT "coupons_window_check" CHECK ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_until" > "valid_from")
);--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_unique" ON public."coupons" ("code");--> statement-breakpoint
ALTER TABLE public."coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."coupons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public."coupons" FROM PUBLIC;--> statement-breakpoint

ALTER TABLE public."subscription_charges" ADD COLUMN "list_price_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD COLUMN "discount_amount" numeric(12, 2) NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD COLUMN "coupon_id" uuid REFERENCES public."coupons"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD COLUMN "referral_credits" integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX "subscription_charges_coupon_idx" ON public."subscription_charges" ("coupon_id", "status") WHERE "coupon_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE public."subscription_charges" DROP CONSTRAINT "subscription_charges_price_check";--> statement-breakpoint
ALTER TABLE public."subscription_charges" DROP CONSTRAINT "subscription_charges_verified_by_check";--> statement-breakpoint
ALTER TABLE public."subscription_charges" DROP CONSTRAINT "subscription_charges_period_days_check";--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD CONSTRAINT "subscription_charges_price_check"
  CHECK ("price_amount" > 0 OR ("price_amount" = 0 AND "verified_by" = 'coupon'));--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD CONSTRAINT "subscription_charges_verified_by_check"
  CHECK ("verified_by" IS NULL OR "verified_by" IN ('webhook', 'reconciliation', 'coupon'));--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD CONSTRAINT "subscription_charges_coupon_grant_check"
  CHECK ("verified_by" IS DISTINCT FROM 'coupon' OR ("price_amount" = 0 AND "provider_payment_id" IS NULL));--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD CONSTRAINT "subscription_charges_period_days_check"
  CHECK ("period_days" IN (30, 365) OR ("verified_by" = 'coupon' AND "period_days" BETWEEN 1 AND 365));--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD CONSTRAINT "subscription_charges_discount_check"
  CHECK ("discount_amount" >= 0 AND ("list_price_amount" IS NULL OR "price_amount" + "discount_amount" = "list_price_amount"));--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD CONSTRAINT "subscription_charges_referral_credits_check"
  CHECK ("referral_credits" BETWEEN 0 AND 5);--> statement-breakpoint

ALTER TABLE public."subscription_payments" DROP CONSTRAINT "subscription_payments_method_check";--> statement-breakpoint
ALTER TABLE public."subscription_payments" DROP CONSTRAINT "subscription_payments_amount_check";--> statement-breakpoint
ALTER TABLE public."subscription_payments" ADD CONSTRAINT "subscription_payments_method_check"
  CHECK ("method" IN ('transfer', 'cash', 'card_manual', 'mercadopago', 'stripe', 'nowpayments', 'coupon'));--> statement-breakpoint
ALTER TABLE public."subscription_payments" ADD CONSTRAINT "subscription_payments_amount_check"
  CHECK ("amount_minor" > 0 OR ("method" = 'coupon' AND "amount_minor" = 0));--> statement-breakpoint

CREATE TABLE public."coupon_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "coupon_id" uuid NOT NULL REFERENCES public."coupons"("id") ON DELETE RESTRICT,
  "charge_id" uuid NOT NULL REFERENCES public."subscription_charges"("id") ON DELETE CASCADE,
  "discount_amount" numeric(12, 2) NOT NULL DEFAULT 0,
  "free_days" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "coupon_redemptions_charge_unique" UNIQUE ("charge_id")
);--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_idx" ON public."coupon_redemptions" ("coupon_id", "tenant_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_tenant_idx" ON public."coupon_redemptions" ("tenant_id", "created_at");--> statement-breakpoint
ALTER TABLE public."coupon_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."coupon_redemptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON public."coupon_redemptions"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DO $$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = 'public.coupon_redemptions'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public.coupon_redemptions AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
END
$$;--> statement-breakpoint
REVOKE ALL ON TABLE public."coupon_redemptions" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."coupons" FROM crmwsp_app;
    REVOKE ALL ON TABLE public."coupon_redemptions" FROM crmwsp_app;
    GRANT SELECT ON TABLE public."coupon_redemptions" TO crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Uses of a coupon: redemptions (settled) + holds (pending charges younger than 24 h with the
-- coupon and not redeemed yet). Holds make max_redemptions race-safe without counting a charge
-- before it is paid; callers lock the coupon row first.
CREATE FUNCTION public."coupon_usage_internal"(p_coupon uuid, p_tenant uuid)
RETURNS TABLE (total_used integer, tenant_used integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  WITH uses AS (
    SELECT r."tenant_id" FROM public."coupon_redemptions" r WHERE r."coupon_id" = p_coupon
    UNION ALL
    SELECT s."tenant_id" FROM public."subscription_charges" s
    WHERE s."coupon_id" = p_coupon AND s."status" = 'pending' AND s."created_at" > pg_catalog.now() - interval '24 hours'
  )
  SELECT pg_catalog.count(*)::integer, (pg_catalog.count(*) FILTER (WHERE u."tenant_id" = p_tenant))::integer FROM uses u;
$fn$;--> statement-breakpoint

-- Why the coupon cannot be used now (NULL = usable). Mirrors couponIneligibility (@crmwsp/billing).
CREATE FUNCTION public."coupon_ineligibility_internal"(c public."coupons", p_tenant uuid, p_plan text, p_period_days integer)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  u record;
BEGIN
  IF NOT c."active" THEN RETURN 'inactive'; END IF;
  IF c."valid_from" IS NOT NULL AND pg_catalog.now() < c."valid_from" THEN RETURN 'not_started'; END IF;
  IF c."valid_until" IS NOT NULL AND pg_catalog.now() >= c."valid_until" THEN RETURN 'expired'; END IF;
  IF pg_catalog.cardinality(c."plans") > 0 AND NOT (p_plan = ANY (c."plans")) THEN RETURN 'plan_not_applicable'; END IF;
  IF c."type" <> 'free_days' AND c."period" <> 'any'
     AND c."period" <> CASE p_period_days WHEN 30 THEN 'monthly' WHEN 365 THEN 'annual' ELSE '' END THEN
    RETURN 'period_not_applicable';
  END IF;
  SELECT * INTO u FROM public."coupon_usage_internal"(c."id", p_tenant);
  IF c."max_redemptions" IS NOT NULL AND u.total_used >= c."max_redemptions" THEN RETURN 'exhausted'; END IF;
  IF u.tenant_used >= c."per_tenant_limit" THEN RETURN 'tenant_limit'; END IF;
  RETURN NULL;
END
$fn$;--> statement-breakpoint

-- Discount on a list price (2 decimals). Mirrors discountCents (@crmwsp/billing): percent rounds
-- half-up to the cent, fixed is capped at the list price, free_days never discounts.
CREATE FUNCTION public."coupon_discount_internal"(p_type text, p_value numeric, p_list numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT CASE p_type
    WHEN 'percent' THEN LEAST(p_list, pg_catalog.floor((p_list * 100 * p_value + 50) / 100) / 100)
    WHEN 'fixed_usd' THEN LEAST(p_list, p_value)
    ELSE 0::numeric
  END;
$fn$;--> statement-breakpoint

-- Coupon as seen by the CURRENT tenant (preview). Unknown code: no row.
CREATE FUNCTION public."coupon_lookup"(p_code text)
RETURNS TABLE (
  coupon_id uuid, code text, type text, value text, plans text[], period text, max_redemptions integer,
  per_tenant_limit integer, valid_from timestamptz, valid_until timestamptz, active boolean, total_used integer, tenant_used integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tenant IS NULL OR p_code IS NULL OR pg_catalog.length(p_code) > 64 THEN
    RAISE EXCEPTION 'coupon_lookup: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT c."id", c."code", c."type", c."value"::text, c."plans", c."period", c."max_redemptions", c."per_tenant_limit",
           c."valid_from", c."valid_until", c."active", u.total_used, u.tenant_used
    FROM public."coupons" c, LATERAL public."coupon_usage_internal"(c."id", v_tenant) u
    WHERE c."code" = pg_catalog.upper(pg_catalog.btrim(p_code));
END
$fn$;--> statement-breakpoint

-- Pending charge with a coupon for the CURRENT tenant. The API passes the plan's list price
-- (@crmwsp/billing); the discount is recomputed HERE under a lock on the coupon row (race-safe
-- against max_redemptions) and the final price stored. Errors: 22023 'coupon: <reason>'.
CREATE FUNCTION public."subscription_charge_create_with_coupon"(
  p_plan text, p_list_price numeric, p_pay_currency text, p_created_by uuid, p_period_days integer, p_code text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  c public."coupons"%ROWTYPE;
  v_reason text;
  v_discount numeric;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL OR p_plan IS NULL OR p_plan NOT IN ('start', 'pro')
     OR p_list_price IS NULL OR p_list_price <= 0 OR p_list_price > 1000000
     OR p_pay_currency IS NULL OR p_pay_currency !~ '^[a-z0-9]{2,20}$'
     OR p_period_days IS NULL OR p_period_days NOT IN (30, 365) OR p_code IS NULL THEN
    RAISE EXCEPTION 'subscription_charge_create_with_coupon: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public."coupons" x WHERE x."code" = pg_catalog.upper(pg_catalog.btrim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon: not_found' USING ERRCODE = '22023';
  END IF;
  v_reason := public."coupon_ineligibility_internal"(c, v_tenant, p_plan, p_period_days);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'coupon: %', v_reason USING ERRCODE = '22023';
  END IF;
  IF c."type" = 'free_days' THEN
    RAISE EXCEPTION 'coupon: free' USING ERRCODE = '22023';
  END IF;
  v_discount := public."coupon_discount_internal"(c."type", c."value", p_list_price);
  IF v_discount >= p_list_price THEN
    RAISE EXCEPTION 'coupon: free' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."subscription_charges"
    ("tenant_id", "plan", "price_amount", "price_currency", "pay_currency", "created_by", "period_days",
     "list_price_amount", "discount_amount", "coupon_id", "coupon_code")
  VALUES (v_tenant, p_plan, p_list_price - v_discount, 'usd', p_pay_currency, p_created_by, p_period_days,
          p_list_price, v_discount, c."id", c."code")
  RETURNING "id" INTO v_id;
  RETURN v_id;
END
$fn$;--> statement-breakpoint

-- Inserts a settled zero-price charge (verified_by='coupon') for the CURRENT tenant, stacking its
-- period like a paid one, plus its derived subscription_payments row. Internal (not granted).
CREATE FUNCTION public."subscription_free_period_internal"(
  p_tenant uuid, p_plan text, p_days integer, p_list_price numeric, p_discount numeric,
  p_coupon_id uuid, p_coupon_code text, p_referral_credits integer, p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_paid_until date;
  v_start date;
  v_end date;
  v_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-period:' || p_tenant::text, 0));
  SELECT pg_catalog.max(sp."period_end") INTO v_paid_until FROM public."subscription_payments" sp WHERE sp."tenant_id" = p_tenant;
  v_start := GREATEST(CURRENT_DATE, coalesce(v_paid_until, CURRENT_DATE));
  v_end := v_start + p_days;
  INSERT INTO public."subscription_charges"
    ("tenant_id", "plan", "price_amount", "price_currency", "pay_currency", "created_by", "period_days", "status", "verified_by",
     "paid_at", "period_start", "period_end", "list_price_amount", "discount_amount", "coupon_id", "coupon_code", "referral_credits",
     "provider_status")
  VALUES (p_tenant, p_plan, 0, 'usd', 'none', p_created_by, p_days, 'paid', 'coupon',
          pg_catalog.now(), v_start, v_end, p_list_price, coalesce(p_discount, 0), p_coupon_id, p_coupon_code, coalesce(p_referral_credits, 0),
          'coupon')
  RETURNING "id" INTO v_id;
  INSERT INTO public."subscription_payments"
    ("tenant_id", "amount_minor", "currency", "period_start", "period_end", "method", "reference", "charge_id", "recorded_by")
  VALUES (p_tenant, 0, 'USD', v_start, v_end, 'coupon', coalesce(p_coupon_code, 'referral'), v_id, p_created_by);
  PERFORM public."subscription_plan_sync_internal"(p_tenant);
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
  VALUES (NULL, 'subscription_charge.coupon_granted', p_tenant,
          pg_catalog.jsonb_build_object('chargeId', v_id, 'createdBy', p_created_by, 'plan', p_plan, 'days', p_days, 'couponCode', p_coupon_code,
                                        'referralCredits', coalesce(p_referral_credits, 0), 'periodStart', v_start, 'periodEnd', v_end));
  RETURN v_id;
END
$fn$;--> statement-breakpoint

-- Redeems a coupon that needs no payment for the CURRENT tenant: free_days (days = value, on the
-- tenant's current plan) or a discount covering the whole list price (one period of p_plan).
-- Counted immediately. Idempotent: a grant of the same coupon for this tenant in the last 2
-- minutes is returned instead of granting again (double submit).
CREATE FUNCTION public."subscription_coupon_grant"(
  p_code text, p_plan text, p_list_price numeric, p_period_days integer, p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  c public."coupons"%ROWTYPE;
  v_reason text;
  v_plan text;
  v_days integer;
  v_discount numeric := 0;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL OR p_code IS NULL OR p_plan IS NULL OR p_plan NOT IN ('start', 'pro')
     OR p_list_price IS NULL OR p_list_price <= 0 OR p_list_price > 1000000
     OR p_period_days IS NULL OR p_period_days NOT IN (30, 365) THEN
    RAISE EXCEPTION 'subscription_coupon_grant: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public."coupons" x WHERE x."code" = pg_catalog.upper(pg_catalog.btrim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon: not_found' USING ERRCODE = '22023';
  END IF;
  SELECT s."id" INTO v_id FROM public."subscription_charges" s
  WHERE s."tenant_id" = v_tenant AND s."coupon_id" = c."id" AND s."verified_by" = 'coupon'
    AND s."created_at" > pg_catalog.now() - interval '2 minutes'
  ORDER BY s."created_at" DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF c."type" = 'free_days' THEN
    SELECT coalesce((SELECT t."plan" FROM public."tenant_plans" t WHERE t."tenant_id" = v_tenant), 'start') INTO v_plan;
    v_days := c."value"::integer;
  ELSE
    v_plan := p_plan;
    v_days := p_period_days;
    v_discount := public."coupon_discount_internal"(c."type", c."value", p_list_price);
    IF v_discount < p_list_price THEN
      RAISE EXCEPTION 'coupon: not_free' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_reason := public."coupon_ineligibility_internal"(c, v_tenant, v_plan, v_days);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'coupon: %', v_reason USING ERRCODE = '22023';
  END IF;
  v_id := public."subscription_free_period_internal"(
    v_tenant, v_plan, v_days, CASE WHEN c."type" = 'free_days' THEN NULL ELSE p_list_price END,
    v_discount, c."id", c."code", 0, p_created_by);
  INSERT INTO public."coupon_redemptions" ("tenant_id", "coupon_id", "charge_id", "discount_amount", "free_days")
  VALUES (v_tenant, c."id", v_id, v_discount, CASE WHEN c."type" = 'free_days' THEN v_days ELSE 0 END);
  RETURN v_id;
END
$fn$;--> statement-breakpoint

-- Called by subscription_charge_apply after a charge became paid: counts its coupon redemption
-- (once per charge). Replaced by 0072 to also handle referrals.
CREATE FUNCTION public."subscription_charge_paid_hook_internal"(p_charge uuid)
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
  IF NOT FOUND OR s."coupon_id" IS NULL THEN
    RETURN;
  END IF;
  PERFORM 1 FROM public."coupons" c WHERE c."id" = s."coupon_id" FOR UPDATE;
  -- Always recorded once paid: the money was received at the discounted price. Holds counted at
  -- creation keep this within max_redemptions (ADR 0017).
  INSERT INTO public."coupon_redemptions" ("tenant_id", "coupon_id", "charge_id", "discount_amount")
  VALUES (s."tenant_id", s."coupon_id", s."id", s."discount_amount")
  ON CONFLICT ("charge_id") DO NOTHING;
END
$fn$;--> statement-breakpoint

-- Called after a paid charge was refunded. No-op here; 0072 revokes referral rewards.
CREATE FUNCTION public."subscription_charge_refund_hook_internal"(p_charge uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  RETURN;
END
$fn$;--> statement-breakpoint

-- Same as 0067 plus the paid/refund hooks.
CREATE OR REPLACE FUNCTION public."subscription_charge_apply"(
  p_charge_id uuid, p_status text, p_verified_by text, p_provider_status text, p_actually_paid numeric, p_payin_hash text
)
RETURNS TABLE (outcome text, period_end date)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  c public."subscription_charges"%ROWTYPE;
  v_paid_until date;
  v_start date;
  v_end date;
  v_prev date;
  v_shifted integer := 0;
  r record;
BEGIN
  IF v_tenant IS NULL OR p_charge_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('pending', 'paid', 'failed', 'expired', 'refunded')
     OR (p_verified_by IS NOT NULL AND p_verified_by NOT IN ('webhook', 'reconciliation'))
     OR pg_catalog.length(coalesce(p_provider_status, '')) > 40
     OR pg_catalog.length(coalesce(p_payin_hash, '')) > 200 THEN
    RAISE EXCEPTION 'subscription_charge_apply: invalid argument' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM public."subscription_charges" s WHERE s."id" = p_charge_id AND s."tenant_id" = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::date;
    RETURN;
  END IF;

  -- Coupon grants have no provider payment: never moved by a provider notification.
  IF c."status" = 'refunded' OR c."verified_by" = 'coupon' THEN
    RETURN QUERY SELECT 'ignored'::text, c."period_end";
    RETURN;
  END IF;

  IF c."status" = 'paid' THEN
    IF p_status <> 'refunded' THEN
      RETURN QUERY SELECT 'ignored'::text, c."period_end";
      RETURN;
    END IF;
    UPDATE public."subscription_charges" s
    SET "status" = 'refunded', "provider_status" = coalesce(p_provider_status, s."provider_status"), "updated_at" = pg_catalog.now()
    WHERE s."id" = c."id";
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-period:' || v_tenant::text, 0));
    DELETE FROM public."subscription_payments" sp WHERE sp."charge_id" = c."id";
    IF c."period_start" IS NOT NULL THEN
      SELECT pg_catalog.max(sp."period_end") INTO v_prev FROM public."subscription_payments" sp
      WHERE sp."tenant_id" = v_tenant AND sp."period_start" < c."period_start";
      FOR r IN
        SELECT s."id", s."paid_at", s."period_start", s."period_end", s."period_days" FROM public."subscription_charges" s
        WHERE s."tenant_id" = v_tenant AND s."status" = 'paid' AND s."id" <> c."id"
          AND s."period_start" >= c."period_start"
        ORDER BY s."period_start", s."paid_at", s."id"
        FOR UPDATE
      LOOP
        v_start := GREATEST((r."paid_at" AT TIME ZONE 'UTC')::date, coalesce(v_prev, (r."paid_at" AT TIME ZONE 'UTC')::date));
        v_end := v_start + r."period_days";
        IF v_start <> r."period_start" OR v_end <> r."period_end" THEN
          UPDATE public."subscription_charges" s
          SET "period_start" = v_start, "period_end" = v_end, "updated_at" = pg_catalog.now() WHERE s."id" = r."id";
          UPDATE public."subscription_payments" sp
          SET "period_start" = v_start, "period_end" = v_end WHERE sp."charge_id" = r."id";
          v_shifted := v_shifted + 1;
        END IF;
        v_prev := v_end;
      END LOOP;
    END IF;
    INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
    VALUES (NULL, 'subscription_charge.refunded', v_tenant,
            pg_catalog.jsonb_build_object('chargeId', c."id", 'periodStart', c."period_start", 'periodEnd', c."period_end",
                                          'restackedCharges', v_shifted));
    PERFORM public."subscription_plan_sync_internal"(v_tenant);
    PERFORM public."subscription_charge_refund_hook_internal"(c."id");
    RETURN QUERY SELECT 'refunded'::text, c."period_end";
    RETURN;
  END IF;

  IF p_status = 'paid' THEN
    IF p_verified_by IS NULL THEN
      RAISE EXCEPTION 'subscription_charge_apply: paid needs verified_by' USING ERRCODE = '22023';
    END IF;
    IF c."pay_amount" IS NULL OR p_actually_paid IS NULL OR p_actually_paid < c."pay_amount" THEN
      RETURN QUERY SELECT 'underpaid'::text, NULL::date;
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-period:' || v_tenant::text, 0));
    SELECT pg_catalog.max(sp."period_end") INTO v_paid_until FROM public."subscription_payments" sp WHERE sp."tenant_id" = v_tenant;
    v_start := GREATEST(CURRENT_DATE, coalesce(v_paid_until, CURRENT_DATE));
    v_end := v_start + c."period_days";
    BEGIN
      UPDATE public."subscription_charges" s
      SET "status" = 'paid', "verified_by" = p_verified_by, "paid_at" = pg_catalog.now(), "actually_paid" = p_actually_paid,
          "payin_hash" = coalesce(p_payin_hash, s."payin_hash"), "provider_status" = coalesce(p_provider_status, s."provider_status"),
          "period_start" = v_start, "period_end" = v_end, "updated_at" = pg_catalog.now()
      WHERE s."id" = c."id" AND s."status" NOT IN ('paid', 'refunded');
    EXCEPTION WHEN unique_violation THEN
      RETURN QUERY SELECT 'payin_hash_conflict'::text, NULL::date;
      RETURN;
    END;
    INSERT INTO public."subscription_payments"
      ("tenant_id", "amount_minor", "currency", "period_start", "period_end", "method", "reference", "charge_id")
    VALUES (v_tenant, pg_catalog.round(c."price_amount" * 100)::bigint, pg_catalog.upper(c."price_currency"), v_start, v_end,
            'nowpayments', c."provider_payment_id", c."id");
    PERFORM public."subscription_plan_sync_internal"(v_tenant);
    PERFORM public."subscription_charge_paid_hook_internal"(c."id");
    INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
    VALUES (NULL, 'subscription_charge.paid', v_tenant,
            pg_catalog.jsonb_build_object('chargeId', c."id", 'plan', c."plan", 'periodDays', c."period_days", 'verifiedBy', p_verified_by,
                                          'periodStart', v_start, 'periodEnd', v_end, 'couponCode', c."coupon_code",
                                          'discount', c."discount_amount"));
    RETURN QUERY SELECT 'paid'::text, v_end;
    RETURN;
  END IF;

  UPDATE public."subscription_charges" s
  SET "status" = p_status, "provider_status" = coalesce(p_provider_status, s."provider_status"),
      "actually_paid" = coalesce(p_actually_paid, s."actually_paid"), "updated_at" = pg_catalog.now()
  WHERE s."id" = c."id" AND s."status" NOT IN ('paid', 'refunded');
  RETURN QUERY SELECT p_status, NULL::date;
END
$fn$;--> statement-breakpoint

-- ---------- Platform backoffice (ADR 0011 conventions) ----------

CREATE FUNCTION public."platform_coupon_list"(p_actor uuid)
RETURNS TABLE (
  coupon_id uuid, code text, type text, value text, plans text[], period text, max_redemptions integer, per_tenant_limit integer,
  valid_from timestamptz, valid_until timestamptz, active boolean, created_at timestamptz, redemptions integer, holds integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT c."id", c."code", c."type", c."value"::text, c."plans", c."period", c."max_redemptions", c."per_tenant_limit",
           c."valid_from", c."valid_until", c."active", c."created_at",
           (SELECT pg_catalog.count(*) FROM public."coupon_redemptions" r WHERE r."coupon_id" = c."id")::integer,
           (SELECT pg_catalog.count(*) FROM public."subscription_charges" s WHERE s."coupon_id" = c."id" AND s."status" = 'pending'
              AND s."created_at" > pg_catalog.now() - interval '24 hours')::integer
    FROM public."coupons" c
    ORDER BY c."created_at" DESC, c."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Creates (p_id NULL) or updates a coupon. Code and type are immutable; value too once used.
CREATE FUNCTION public."platform_coupon_save"(
  p_actor uuid, p_id uuid, p_code text, p_type text, p_value numeric, p_plans text[], p_period text,
  p_max_redemptions integer, p_per_tenant_limit integer, p_valid_from timestamptz, p_valid_until timestamptz, p_active boolean, p_ip inet
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  old public."coupons"%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_id IS NULL THEN
    BEGIN
      INSERT INTO public."coupons" ("code", "type", "value", "plans", "period", "max_redemptions", "per_tenant_limit",
                                    "valid_from", "valid_until", "active", "created_by")
      VALUES (pg_catalog.upper(pg_catalog.btrim(p_code)), p_type, p_value, coalesce(p_plans, '{}'::text[]), coalesce(p_period, 'any'),
              p_max_redemptions, coalesce(p_per_tenant_limit, 1), p_valid_from, p_valid_until, coalesce(p_active, true), p_actor)
      RETURNING "id" INTO v_id;
    EXCEPTION
      WHEN unique_violation THEN RAISE EXCEPTION 'platform: coupon code taken' USING ERRCODE = '23505';
      WHEN check_violation THEN RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
    END;
    INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
    VALUES (p_actor, 'coupon.created', NULL, pg_catalog.jsonb_build_object('couponId', v_id, 'code', pg_catalog.upper(pg_catalog.btrim(p_code)),
            'type', p_type, 'value', p_value), p_ip);
    RETURN v_id;
  END IF;
  SELECT * INTO old FROM public."coupons" c WHERE c."id" = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform: not found' USING ERRCODE = 'P0002';
  END IF;
  IF pg_catalog.upper(pg_catalog.btrim(p_code)) <> old."code" OR p_type <> old."type" THEN
    RAISE EXCEPTION 'platform: coupon code and type are immutable' USING ERRCODE = '22023';
  END IF;
  IF p_value <> old."value" AND EXISTS (SELECT 1 FROM public."subscription_charges" s WHERE s."coupon_id" = p_id) THEN
    RAISE EXCEPTION 'platform: coupon already used' USING ERRCODE = '22023';
  END IF;
  BEGIN
    UPDATE public."coupons" c
    SET "value" = p_value, "plans" = coalesce(p_plans, '{}'::text[]), "period" = coalesce(p_period, 'any'),
        "max_redemptions" = p_max_redemptions, "per_tenant_limit" = coalesce(p_per_tenant_limit, 1),
        "valid_from" = p_valid_from, "valid_until" = p_valid_until, "active" = coalesce(p_active, true), "updated_at" = pg_catalog.now()
    WHERE c."id" = p_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'coupon.updated', NULL,
          pg_catalog.jsonb_build_object('couponId', p_id, 'code', old."code",
            'from', pg_catalog.jsonb_build_object('value', old."value", 'active', old."active", 'max', old."max_redemptions", 'validUntil', old."valid_until"),
            'to', pg_catalog.jsonb_build_object('value', p_value, 'active', p_active, 'max', p_max_redemptions, 'validUntil', p_valid_until)), p_ip);
  RETURN p_id;
END
$fn$;--> statement-breakpoint

-- Deletes a never-used coupon (otherwise deactivate it).
CREATE FUNCTION public."platform_coupon_delete"(p_actor uuid, p_id uuid, p_ip inet)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_code text;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  SELECT c."code" INTO v_code FROM public."coupons" c WHERE c."id" = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform: not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public."subscription_charges" s WHERE s."coupon_id" = p_id) THEN
    RAISE EXCEPTION 'platform: coupon already used' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public."coupons" c WHERE c."id" = p_id;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'coupon.deleted', NULL, pg_catalog.jsonb_build_object('couponId', p_id, 'code', v_code), p_ip);
  RETURN true;
END
$fn$;--> statement-breakpoint

CREATE FUNCTION public."platform_coupon_redemptions"(p_actor uuid, p_coupon_id uuid)
RETURNS TABLE (
  redemption_id uuid, tenant_id uuid, tenant_name text, charge_id uuid, plan text, discount_amount text, free_days integer,
  price_amount text, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT r."id", r."tenant_id", t."name", r."charge_id", s."plan", r."discount_amount"::text, r."free_days",
           s."price_amount"::text, r."created_at"
    FROM public."coupon_redemptions" r
    JOIN public."tenants" t ON t."id" = r."tenant_id"
    JOIN public."subscription_charges" s ON s."id" = r."charge_id"
    WHERE r."coupon_id" = p_coupon_id
    ORDER BY r."created_at" DESC, r."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."coupon_usage_internal"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."coupon_ineligibility_internal"(public."coupons", uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."coupon_lookup"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_charge_create_with_coupon"(text, numeric, text, uuid, integer, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_free_period_internal"(uuid, text, integer, numeric, numeric, uuid, text, integer, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_coupon_grant"(text, text, numeric, integer, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_charge_paid_hook_internal"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_charge_refund_hook_internal"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_coupon_list"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_coupon_save"(uuid, uuid, text, text, numeric, text[], text, integer, integer, timestamptz, timestamptz, boolean, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_coupon_delete"(uuid, uuid, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_coupon_redemptions"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."coupon_lookup"(text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."subscription_charge_create_with_coupon"(text, numeric, text, uuid, integer, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."subscription_coupon_grant"(text, text, numeric, integer, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_coupon_list"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_coupon_save"(uuid, uuid, text, text, numeric, text[], text, integer, integer, timestamptz, timestamptz, boolean, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_coupon_delete"(uuid, uuid, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_coupon_redemptions"(uuid, uuid) TO crmwsp_app;
  END IF;
END
$$;
