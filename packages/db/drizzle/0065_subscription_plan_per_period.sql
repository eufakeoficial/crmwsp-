-- Security finding F7: each settled charge grants its plan only for its own [period_start,
-- period_end). Settling a charge stacked in the future no longer switches tenant_plans.plan at
-- once; the plan follows the paid charge covering today. subscription_plan_sync_due() (worker
-- tick) applies the switch when a stacked period begins. Refund re-stacking (0064) re-syncs too.
CREATE OR REPLACE FUNCTION public."subscription_plan_sync_internal"(p_tenant uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_plan text;
BEGIN
  SELECT s."plan" INTO v_plan FROM public."subscription_charges" s
  WHERE s."tenant_id" = p_tenant AND s."status" = 'paid'
    AND s."period_start" <= CURRENT_DATE AND CURRENT_DATE < s."period_end"
  ORDER BY s."period_start" DESC, s."paid_at" DESC, s."id"
  LIMIT 1;
  -- No covering paid charge (manual period, lapsed): leave the plan as it is.
  IF v_plan IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public."tenant_plans" ("tenant_id", "plan") VALUES (p_tenant, v_plan)
  ON CONFLICT ("tenant_id") DO UPDATE SET "plan" = excluded."plan", "updated_at" = pg_catalog.now()
  WHERE public."tenant_plans"."plan" IS DISTINCT FROM excluded."plan";
  RETURN true;
END
$fn$;--> statement-breakpoint

-- Worker tick (no tenant context): switches the plan of tenants whose covering paid charge
-- differs from tenant_plans.plan, e.g. a stacked Pro period that began today. Returns how many.
CREATE OR REPLACE FUNCTION public."subscription_plan_sync_due"(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT s."tenant_id" FROM public."subscription_charges" s
    LEFT JOIN public."tenant_plans" tp ON tp."tenant_id" = s."tenant_id"
    WHERE s."status" = 'paid' AND s."period_start" <= CURRENT_DATE AND CURRENT_DATE < s."period_end"
      AND tp."plan" IS DISTINCT FROM s."plan"
    LIMIT LEAST(GREATEST(coalesce(p_limit, 200), 1), 1000)
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-period:' || r."tenant_id"::text, 0));
    IF public."subscription_plan_sync_internal"(r."tenant_id") THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
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
    -- at max(its payment day, end of the previous remaining period), lasts 30 days, and its derived
    -- subscription_payments row follows. Manual (backoffice) periods are never moved.
    IF c."period_start" IS NOT NULL THEN
      SELECT pg_catalog.max(sp."period_end") INTO v_prev FROM public."subscription_payments" sp
      WHERE sp."tenant_id" = v_tenant AND sp."period_start" < c."period_start";
      FOR r IN
        SELECT s."id", s."paid_at", s."period_start", s."period_end" FROM public."subscription_charges" s
        WHERE s."tenant_id" = v_tenant AND s."status" = 'paid' AND s."id" <> c."id"
          AND s."period_start" >= c."period_start"
        ORDER BY s."period_start", s."paid_at", s."id"
        FOR UPDATE
      LOOP
        v_start := GREATEST((r."paid_at" AT TIME ZONE 'UTC')::date, coalesce(v_prev, (r."paid_at" AT TIME ZONE 'UTC')::date));
        v_end := v_start + 30;
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
    -- F7 (0065): the plan follows the period covering today, not the charge just settled.
    PERFORM public."subscription_plan_sync_internal"(v_tenant);
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

REVOKE ALL ON FUNCTION public."subscription_plan_sync_internal"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."subscription_plan_sync_due"(integer) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."subscription_plan_sync_due"(integer) TO crmwsp_app;
  END IF;
END
$$;
