-- Annual subscription charges (ADR 0015): each charge stores how many days it grants (30 monthly,
-- 365 annual). Creation takes the period; settlement and refund re-stacking use the charge's own
-- length instead of a hard-coded 30. Existing rows are monthly (default 30).
ALTER TABLE public."subscription_charges" ADD COLUMN "period_days" integer NOT NULL DEFAULT 30;--> statement-breakpoint
ALTER TABLE public."subscription_charges" ADD CONSTRAINT "subscription_charges_period_days_check" CHECK ("period_days" IN (30, 365));--> statement-breakpoint

DROP FUNCTION public."subscription_charge_create"(text, numeric, text, text, uuid);--> statement-breakpoint

-- Creates a pending charge for the CURRENT tenant (app.tenant_id). The API passes the price of the
-- plan for the chosen period (@crmwsp/billing); the worker re-checks it before settling.
CREATE FUNCTION public."subscription_charge_create"(
  p_plan text, p_price_amount numeric, p_price_currency text, p_pay_currency text, p_created_by uuid, p_period_days integer
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
     OR p_pay_currency IS NULL OR p_pay_currency !~ '^[a-z0-9]{2,20}$'
     OR p_period_days IS NULL OR p_period_days NOT IN (30, 365) THEN
    RAISE EXCEPTION 'subscription_charge_create: invalid argument' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."subscription_charges" ("tenant_id", "plan", "price_amount", "price_currency", "pay_currency", "created_by", "period_days")
  VALUES (v_tenant, p_plan, p_price_amount, p_price_currency, p_pay_currency, p_created_by, p_period_days)
  RETURNING "id" INTO v_id;
  RETURN v_id;
END
$fn$;--> statement-breakpoint

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
    -- Same lock as period grants: the refund and the re-stacking below see a stable set of periods.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-period:' || v_tenant::text, 0));
    DELETE FROM public."subscription_payments" sp WHERE sp."charge_id" = c."id";
    -- Re-stack later paid charges as if the refunded period never existed (0064): each one starts
    -- at max(its payment day, end of the previous remaining period), lasts its own period_days (0067), and its derived
    -- subscription_payments row follows. Manual (backoffice) periods are never moved.
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
    -- F7 (0065): the plan follows the period covering today, not the charge just settled.
    PERFORM public."subscription_plan_sync_internal"(v_tenant);
    INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
    VALUES (NULL, 'subscription_charge.paid', v_tenant,
            pg_catalog.jsonb_build_object('chargeId', c."id", 'plan', c."plan", 'periodDays', c."period_days", 'verifiedBy', p_verified_by,
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

REVOKE ALL ON FUNCTION public."subscription_charge_create"(text, numeric, text, text, uuid, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_charge_apply"(uuid, text, text, text, numeric, text) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."subscription_charge_create"(text, numeric, text, text, uuid, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."subscription_charge_apply"(uuid, text, text, text, numeric, text) TO crmwsp_app;
  END IF;
END
$$;
