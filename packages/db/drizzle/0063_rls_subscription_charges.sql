-- RLS and SECURITY DEFINER functions for SaaS subscription charges (ADR 0013), same conventions
-- as 0024/0052: owned by the migrator, fixed search_path with pg_temp last, schema-qualified
-- objects, EXECUTE only for crmwsp_app, errors without data.
-- subscription_charges is READ-ONLY for the app role (own tenant): a tenant can never mark its
-- own charge paid or extend its period. Writes only through the functions below.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "subscription_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription_charges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "subscription_charges"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DO $$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = 'public.subscription_charges'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public.subscription_charges AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public."subscription_charges" FROM crmwsp_app;
    GRANT SELECT ON public."subscription_charges" TO crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Creates a pending charge for the CURRENT tenant (app.tenant_id). The API passes the price from
-- the plan definitions (@crmwsp/billing); the provider fields are attached after the API call.
CREATE FUNCTION public."subscription_charge_create"(
  p_plan text, p_price_amount numeric, p_price_currency text, p_pay_currency text, p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL OR p_plan IS NULL OR p_plan NOT IN ('start', 'pro')
     OR p_price_amount IS NULL OR p_price_amount <= 0 OR p_price_amount > 1000000
     OR p_price_currency IS NULL OR p_price_currency !~ '^[a-z]{3}$'
     OR p_pay_currency IS NULL OR p_pay_currency !~ '^[a-z0-9]{2,20}$' THEN
    RAISE EXCEPTION 'subscription_charge_create: invalid argument' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."subscription_charges" ("tenant_id", "plan", "price_amount", "price_currency", "pay_currency", "created_by")
  VALUES (v_tenant, p_plan, p_price_amount, p_price_currency, p_pay_currency, p_created_by)
  RETURNING "id" INTO v_id;
  RETURN v_id;
END
$fn$;--> statement-breakpoint

-- Stores the NOWPayments invoice on a pending charge of the current tenant, exactly once.
CREATE FUNCTION public."subscription_charge_attach"(
  p_charge_id uuid, p_provider_payment_id text, p_pay_address text, p_pay_amount numeric, p_pay_currency text, p_provider_status text
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
  IF v_tenant IS NULL OR p_charge_id IS NULL OR p_provider_payment_id IS NULL OR p_provider_payment_id !~ '^[0-9]{1,30}$'
     OR p_pay_address IS NULL OR pg_catalog.length(p_pay_address) NOT BETWEEN 1 AND 200
     OR p_pay_amount IS NULL OR p_pay_amount <= 0
     OR p_pay_currency IS NULL OR p_pay_currency !~ '^[a-z0-9]{2,20}$'
     OR pg_catalog.length(coalesce(p_provider_status, '')) > 40 THEN
    RAISE EXCEPTION 'subscription_charge_attach: invalid argument' USING ERRCODE = '22023';
  END IF;
  UPDATE public."subscription_charges" s
  SET "provider_payment_id" = p_provider_payment_id, "pay_address" = p_pay_address, "pay_amount" = p_pay_amount,
      "pay_currency" = p_pay_currency, "provider_status" = p_provider_status, "updated_at" = pg_catalog.now()
  WHERE s."id" = p_charge_id AND s."tenant_id" = v_tenant AND s."status" = 'pending' AND s."provider_payment_id" IS NULL;
  RETURN FOUND;
END
$fn$;--> statement-breakpoint

-- Persists a VERIFIED NOWPayments notification (IPN, or a reconciliation poll with the
-- 'reconcile:' prefix) in inbound_events. The tenant comes from the charge (order_id), never from
-- the caller. Unknown order ids return no row.
CREATE FUNCTION public."ingest_nowpayments_event"(p_dedupe_key text, p_order_id text, p_payload jsonb)
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
     OR (p_dedupe_key NOT LIKE 'nowpayments:%' AND p_dedupe_key NOT LIKE 'reconcile:nowpayments:%') THEN
    RAISE EXCEPTION 'ingest_nowpayments_event: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.octet_length(p_payload::text) > 65536 THEN
    RAISE EXCEPTION 'ingest_nowpayments_event: payload too large' USING ERRCODE = '54000';
  END IF;
  IF p_order_id IS NULL OR p_order_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN;
  END IF;
  SELECT s."tenant_id" INTO v_tenant FROM public."subscription_charges" s WHERE s."id" = p_order_id::uuid;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public."inbound_events" ("tenant_id", "provider", "dedupe_key", "channel_connection_id", "payload", "signature_valid")
  VALUES (v_tenant, 'nowpayments'::public."channel_provider", p_dedupe_key, NULL, p_payload, true)
  ON CONFLICT ("provider", "dedupe_key") DO NOTHING
  RETURNING "id" INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    RETURN QUERY SELECT v_event_id, v_tenant, true;
    RETURN;
  END IF;
  SELECT e."id" INTO v_event_id FROM public."inbound_events" e
  WHERE e."provider" = 'nowpayments'::public."channel_provider" AND e."dedupe_key" = p_dedupe_key AND e."tenant_id" = v_tenant;
  RETURN QUERY SELECT v_event_id, v_tenant, false;
END
$fn$;--> statement-breakpoint

-- Settlement (worker, inside withTenant). The decision comes from @crmwsp/billing
-- `decideSettlement`; this function re-enforces the invariants atomically:
--  * paid/refunded are terminal; only paid -> refunded is allowed afterwards;
--  * paid needs verified_by (webhook | reconciliation) and actually_paid >= pay_amount;
--  * one payin_hash settles at most one charge (unique constraint);
--  * pending -> paid and the 30-day period (subscription_payments + tenant_plans) commit together;
--  * refunded revokes the period (removes the derived revenue row; the charge stays as audit).
-- Period: start = max(today, current paid_until), end = start + 30 (same as `nextPeriod`).
CREATE FUNCTION public."subscription_charge_apply"(
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

  IF c."status" = 'refunded' THEN
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
    DELETE FROM public."subscription_payments" sp WHERE sp."charge_id" = c."id";
    INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
    VALUES (NULL, 'subscription_charge.refunded', v_tenant,
            pg_catalog.jsonb_build_object('chargeId', c."id", 'periodStart', c."period_start", 'periodEnd', c."period_end"));
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
    -- Serializes period grants of one tenant (two charges settling at once must stack).
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-period:' || v_tenant::text, 0));
    SELECT pg_catalog.max(sp."period_end") INTO v_paid_until FROM public."subscription_payments" sp WHERE sp."tenant_id" = v_tenant;
    v_start := GREATEST(CURRENT_DATE, coalesce(v_paid_until, CURRENT_DATE));
    v_end := v_start + 30;
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
    INSERT INTO public."tenant_plans" ("tenant_id", "plan") VALUES (v_tenant, c."plan")
    ON CONFLICT ("tenant_id") DO UPDATE SET "plan" = excluded."plan", "updated_at" = pg_catalog.now();
    INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
    VALUES (NULL, 'subscription_charge.paid', v_tenant,
            pg_catalog.jsonb_build_object('chargeId', c."id", 'plan', c."plan", 'verifiedBy', p_verified_by,
                                          'periodStart', v_start, 'periodEnd', v_end));
    RETURN QUERY SELECT 'paid'::text, v_end;
    RETURN;
  END IF;

  -- Non-terminal transitions (pending / failed / expired), or a refund of a never-paid charge.
  UPDATE public."subscription_charges" s
  SET "status" = p_status, "provider_status" = coalesce(p_provider_status, s."provider_status"),
      "actually_paid" = coalesce(p_actually_paid, s."actually_paid"), "updated_at" = pg_catalog.now()
  WHERE s."id" = c."id" AND s."status" NOT IN ('paid', 'refunded');
  RETURN QUERY SELECT p_status, NULL::date;
END
$fn$;--> statement-breakpoint

-- Pending charges with an invoice, older than p_min_age_seconds and younger than 14 days, oldest
-- poll first (reconciliation worker; no tenant context).
CREATE FUNCTION public."subscription_stale_charges"(p_min_age_seconds integer, p_limit integer)
RETURNS TABLE (charge_id uuid, tenant_id uuid, provider_payment_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT s."id", s."tenant_id", s."provider_payment_id"
  FROM public."subscription_charges" s
  WHERE s."status" = 'pending' AND s."provider_payment_id" IS NOT NULL
    AND s."created_at" < pg_catalog.now() - pg_catalog.make_interval(secs => GREATEST(coalesce(p_min_age_seconds, 300), 60))
    AND s."created_at" > pg_catalog.now() - interval '14 days'
  ORDER BY s."updated_at", s."id"
  LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 500);
$fn$;--> statement-breakpoint

-- Last paid day of the CURRENT tenant (null = never paid). subscription_payments stays
-- unreachable for the app role; this exposes only one date of its own tenant.
CREATE FUNCTION public."tenant_subscription_paid_until"()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT pg_catalog.max(sp."period_end") FROM public."subscription_payments" sp
  WHERE sp."tenant_id" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
$fn$;--> statement-breakpoint

-- Platform backoffice: NOWPayments charges (all states), newest first, max 500.
CREATE FUNCTION public."platform_list_subscription_charges"(p_actor uuid, p_tenant_id uuid, p_status text)
RETURNS TABLE (
  charge_id uuid, tenant_id uuid, tenant_name text, plan text, price_amount text, price_currency text,
  pay_currency text, pay_amount text, actually_paid text, provider_payment_id text, status text,
  provider_status text, verified_by text, paid_at timestamptz, period_start date, period_end date, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'paid', 'failed', 'expired', 'refunded') THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT s."id", s."tenant_id", t."name", s."plan", s."price_amount"::text, s."price_currency", s."pay_currency",
           s."pay_amount"::text, s."actually_paid"::text, s."provider_payment_id", s."status", s."provider_status",
           s."verified_by", s."paid_at", s."period_start", s."period_end", s."created_at"
    FROM public."subscription_charges" s
    JOIN public."tenants" t ON t."id" = s."tenant_id"
    WHERE (p_tenant_id IS NULL OR s."tenant_id" = p_tenant_id)
      AND (p_status IS NULL OR s."status" = p_status)
    ORDER BY s."created_at" DESC, s."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."subscription_charge_create"(text, numeric, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_charge_attach"(uuid, text, text, numeric, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."ingest_nowpayments_event"(text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_charge_apply"(uuid, text, text, text, numeric, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_stale_charges"(integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_subscription_paid_until"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_list_subscription_charges"(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."subscription_charge_create"(text, numeric, text, text, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."subscription_charge_attach"(uuid, text, text, numeric, text, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."ingest_nowpayments_event"(text, text, jsonb) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."subscription_charge_apply"(uuid, text, text, text, numeric, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."subscription_stale_charges"(integer, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."tenant_subscription_paid_until"() TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_list_subscription_charges"(uuid, uuid, text) TO crmwsp_app;
  END IF;
END
$$;
