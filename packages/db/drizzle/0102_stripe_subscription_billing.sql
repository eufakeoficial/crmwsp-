-- Card billing of the SaaS subscription with Stripe Billing (ADR 0022). Same conventions as 0063:
-- tables are READ-ONLY for the app role (own tenant, RLS); every write goes through SECURITY DEFINER
-- functions owned by the migrator with a fixed search_path. `paid` only comes from a verified
-- webhook (`verified_by = 'webhook'`), never from the client or a checkout redirect.
-- 'stripe' joins the inbound_events provider enum so verified events land in inbound_events first
-- (dedupe_key `stripe_billing:<event id>`). The new value is only referenced from plpgsql bodies.

ALTER TYPE "public"."channel_provider" ADD VALUE IF NOT EXISTS 'stripe';--> statement-breakpoint

ALTER TABLE public."subscription_charges" DROP CONSTRAINT "subscription_charges_provider_check";--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD CONSTRAINT "subscription_charges_provider_check" CHECK ("provider" IN ('nowpayments', 'stripe'));--> statement-breakpoint

-- One Stripe customer (and at most one live subscription) per tenant.
CREATE TABLE public."subscription_billing_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "stripe_customer_id" text NOT NULL,
  "stripe_subscription_id" text,
  "plan" text,
  "period" text,
  "status" text NOT NULL DEFAULT 'none',
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "current_period_end" timestamptz,
  -- Stripe `created` of the last event applied: an older, reordered event never overwrites a newer one.
  "status_event_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "subscription_billing_accounts_tenant_unique" UNIQUE ("tenant_id"),
  CONSTRAINT "subscription_billing_accounts_customer_unique" UNIQUE ("stripe_customer_id"),
  CONSTRAINT "subscription_billing_accounts_subscription_unique" UNIQUE ("stripe_subscription_id"),
  CONSTRAINT "subscription_billing_accounts_customer_check" CHECK ("stripe_customer_id" ~ '^cus_[A-Za-z0-9]{1,100}$'),
  CONSTRAINT "subscription_billing_accounts_subscription_check" CHECK ("stripe_subscription_id" IS NULL OR "stripe_subscription_id" ~ '^sub_[A-Za-z0-9]{1,100}$'),
  CONSTRAINT "subscription_billing_accounts_plan_check" CHECK ("plan" IS NULL OR "plan" IN ('start', 'pro')),
  CONSTRAINT "subscription_billing_accounts_period_check" CHECK ("period" IS NULL OR "period" IN ('monthly', 'annual')),
  CONSTRAINT "subscription_billing_accounts_status_check" CHECK ("status" IN ('none', 'incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused'))
);--> statement-breakpoint

ALTER TABLE public."subscription_billing_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."subscription_billing_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON public."subscription_billing_accounts"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DO $$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = 'public.subscription_billing_accounts'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public.subscription_billing_accounts AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public."subscription_billing_accounts" FROM crmwsp_app;
    GRANT SELECT ON public."subscription_billing_accounts" TO crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Stores the Stripe customer of the CURRENT tenant exactly once and returns the stored id (a
-- concurrent request that lost the race gets the winner's customer back).
CREATE FUNCTION public."stripe_billing_account_attach"(p_customer_id text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_customer text;
BEGIN
  IF v_tenant IS NULL OR p_customer_id IS NULL OR p_customer_id !~ '^cus_[A-Za-z0-9]{1,100}$' THEN
    RAISE EXCEPTION 'stripe_billing_account_attach: invalid argument' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."subscription_billing_accounts" ("tenant_id", "stripe_customer_id")
  VALUES (v_tenant, p_customer_id)
  ON CONFLICT ("tenant_id") DO NOTHING;
  SELECT a."stripe_customer_id" INTO v_customer FROM public."subscription_billing_accounts" a WHERE a."tenant_id" = v_tenant;
  RETURN v_customer;
END
$fn$;--> statement-breakpoint

-- Persists a VERIFIED Stripe billing event in inbound_events. The tenant is resolved from OUR
-- billing account row by customer id, never from the payload metadata. Unknown customers return
-- no row (acknowledged and dropped).
CREATE FUNCTION public."ingest_stripe_billing_event"(p_dedupe_key text, p_customer_id text, p_payload jsonb)
RETURNS TABLE (event_id uuid, tenant_id uuid, inserted boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_event_id uuid;
BEGIN
  IF p_dedupe_key IS NULL OR p_payload IS NULL
     OR pg_catalog.length(p_dedupe_key) > 512
     OR p_dedupe_key NOT LIKE 'stripe_billing:%' THEN
    RAISE EXCEPTION 'ingest_stripe_billing_event: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.octet_length(p_payload::text) > 262144 THEN
    RAISE EXCEPTION 'ingest_stripe_billing_event: payload too large' USING ERRCODE = '54000';
  END IF;
  IF p_customer_id IS NULL OR p_customer_id !~ '^cus_[A-Za-z0-9]{1,100}$' THEN
    RETURN;
  END IF;
  SELECT a."tenant_id" INTO v_tenant FROM public."subscription_billing_accounts" a WHERE a."stripe_customer_id" = p_customer_id;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public."inbound_events" ("tenant_id", "provider", "dedupe_key", "channel_connection_id", "payload", "signature_valid")
  VALUES (v_tenant, 'stripe'::public."channel_provider", p_dedupe_key, NULL, p_payload, true)
  ON CONFLICT ("provider", "dedupe_key") DO NOTHING
  RETURNING "id" INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    RETURN QUERY SELECT v_event_id, v_tenant, true;
    RETURN;
  END IF;
  SELECT e."id" INTO v_event_id FROM public."inbound_events" e
  WHERE e."provider" = 'stripe'::public."channel_provider" AND e."dedupe_key" = p_dedupe_key AND e."tenant_id" = v_tenant;
  RETURN QUERY SELECT v_event_id, v_tenant, false;
END
$fn$;--> statement-breakpoint

-- Settles one PAID Stripe invoice for the CURRENT tenant (worker, inside withTenant). The decision
-- (known price id, exact plan price, currency) comes from @crmwsp/billing `decideStripeInvoice`;
-- this function re-enforces the invariants atomically:
--  * the invoice belongs to the tenant's own Stripe customer;
--  * one invoice settles at most once (subscription_charges.provider_payment_id is unique), so
--    replays and reordered events never grant a second period;
--  * the charge (status paid, verified_by webhook), its period (subscription_payments, method
--    'stripe') and tenant_plans commit together. Period: start = max(today, current paid_until),
--    end = start + days (same stacking rule as NOWPayments, so renewals extend, never overlap).
CREATE FUNCTION public."stripe_invoice_settle"(
  p_customer_id text, p_invoice_id text, p_subscription_id text, p_plan text, p_period_days integer,
  p_amount_minor bigint, p_currency text
)
RETURNS TABLE (outcome text, charge_id uuid, period_end date)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_paid_until date;
  v_start date;
  v_end date;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL OR p_customer_id IS NULL OR p_invoice_id IS NULL OR p_invoice_id !~ '^in_[A-Za-z0-9]{1,100}$'
     OR p_plan IS NULL OR p_plan NOT IN ('start', 'pro')
     OR p_period_days IS NULL OR p_period_days NOT IN (30, 365)
     OR p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_amount_minor > 100000000
     OR p_currency IS NULL OR p_currency !~ '^[a-z]{3}$'
     OR (p_subscription_id IS NOT NULL AND p_subscription_id !~ '^sub_[A-Za-z0-9]{1,100}$') THEN
    RAISE EXCEPTION 'stripe_invoice_settle: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."subscription_billing_accounts" a WHERE a."tenant_id" = v_tenant AND a."stripe_customer_id" = p_customer_id) THEN
    RETURN QUERY SELECT 'unknown_customer'::text, NULL::uuid, NULL::date;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-period:' || v_tenant::text, 0));
  SELECT s."id", s."period_end" INTO v_id, v_end FROM public."subscription_charges" s WHERE s."provider_payment_id" = p_invoice_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'ignored'::text, v_id, v_end;
    RETURN;
  END IF;

  SELECT pg_catalog.max(sp."period_end") INTO v_paid_until FROM public."subscription_payments" sp WHERE sp."tenant_id" = v_tenant;
  v_start := GREATEST(CURRENT_DATE, coalesce(v_paid_until, CURRENT_DATE));
  v_end := v_start + p_period_days;
  INSERT INTO public."subscription_charges"
    ("tenant_id", "plan", "provider", "price_amount", "price_currency", "pay_currency", "provider_payment_id", "provider_status",
     "status", "verified_by", "paid_at", "period_start", "period_end", "period_days")
  VALUES (v_tenant, p_plan, 'stripe', (p_amount_minor::numeric / 100)::numeric(12, 2), p_currency, 'card', p_invoice_id, 'paid',
          'paid', 'webhook', pg_catalog.now(), v_start, v_end, p_period_days)
  RETURNING "id" INTO v_id;
  INSERT INTO public."subscription_payments"
    ("tenant_id", "amount_minor", "currency", "period_start", "period_end", "method", "reference", "charge_id")
  VALUES (v_tenant, p_amount_minor, pg_catalog.upper(p_currency), v_start, v_end, 'stripe', p_invoice_id, v_id);
  PERFORM public."subscription_plan_sync_internal"(v_tenant);
  PERFORM public."subscription_charge_paid_hook_internal"(v_id);
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
  VALUES (NULL, 'subscription_charge.paid', v_tenant,
          pg_catalog.jsonb_build_object('chargeId', v_id, 'plan', p_plan, 'periodDays', p_period_days, 'verifiedBy', 'webhook',
                                        'provider', 'stripe', 'periodStart', v_start, 'periodEnd', v_end));
  RETURN QUERY SELECT 'paid'::text, v_id, v_end;
END
$fn$;--> statement-breakpoint

-- Mirrors the Stripe subscription state on the tenant's billing account (informational: it does
-- NOT grant or revoke access; access only follows paid periods, ADR 0013/0015).
CREATE FUNCTION public."stripe_billing_subscription_sync"(
  p_customer_id text, p_subscription_id text, p_status text, p_plan text, p_period text,
  p_cancel_at_period_end boolean, p_current_period_end timestamptz, p_event_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tenant IS NULL OR p_customer_id IS NULL
     OR p_status IS NULL OR p_status NOT IN ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')
     OR (p_subscription_id IS NOT NULL AND p_subscription_id !~ '^sub_[A-Za-z0-9]{1,100}$')
     OR (p_plan IS NOT NULL AND p_plan NOT IN ('start', 'pro'))
     OR (p_period IS NOT NULL AND p_period NOT IN ('monthly', 'annual')) THEN
    RAISE EXCEPTION 'stripe_billing_subscription_sync: invalid argument' USING ERRCODE = '22023';
  END IF;
  UPDATE public."subscription_billing_accounts" a
  SET "stripe_subscription_id" = coalesce(p_subscription_id, a."stripe_subscription_id"),
      "status" = p_status,
      "plan" = coalesce(p_plan, a."plan"),
      "period" = coalesce(p_period, a."period"),
      "cancel_at_period_end" = coalesce(p_cancel_at_period_end, a."cancel_at_period_end"),
      "current_period_end" = coalesce(p_current_period_end, a."current_period_end"),
      "status_event_at" = coalesce(p_event_at, a."status_event_at"),
      "updated_at" = pg_catalog.now()
  WHERE a."tenant_id" = v_tenant AND a."stripe_customer_id" = p_customer_id
    AND (p_event_at IS NULL OR a."status_event_at" IS NULL OR a."status_event_at" <= p_event_at);
  RETURN FOUND;
EXCEPTION WHEN unique_violation THEN
  -- The subscription id already belongs to another account: never move it.
  RETURN false;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."stripe_billing_account_attach"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."ingest_stripe_billing_event"(text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."stripe_invoice_settle"(text, text, text, text, integer, bigint, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."stripe_billing_subscription_sync"(text, text, text, text, text, boolean, timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."stripe_billing_account_attach"(text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."ingest_stripe_billing_event"(text, text, jsonb) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."stripe_invoice_settle"(text, text, text, text, integer, bigint, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."stripe_billing_subscription_sync"(text, text, text, text, text, boolean, timestamptz, timestamptz) TO crmwsp_app;
  END IF;
END
$$;
