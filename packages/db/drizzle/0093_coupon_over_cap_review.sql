-- Coupon max_redemptions overshoot (odd/tasks/fix-prelanzamiento.md, F7).
-- Holds (pending charges < 24 h, 0071) keep max_redemptions race-safe at creation, but a charge
-- paid after its hold expired can settle once the cap was reached by others. The money was paid at
-- the discounted price, so the redemption is ALWAYS recorded (never undercharge retroactively); it
-- is flagged `over_cap` for platform review and audited as `coupon.redemption_over_cap`.
-- The 24 h hold is kept: crypto invoices can confirm late, and a shorter hold would only make the
-- overshoot more frequent.

ALTER TABLE public."coupon_redemptions" ADD COLUMN "over_cap" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- Same as 0072 plus the cap re-check under the coupon row lock.
CREATE OR REPLACE FUNCTION public."subscription_charge_paid_hook_internal"(p_charge uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  s public."subscription_charges"%ROWTYPE;
  v_max integer;
  v_code text;
  v_used integer;
  v_over boolean := false;
  v_count integer;
BEGIN
  SELECT * INTO s FROM public."subscription_charges" x WHERE x."id" = p_charge;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF s."coupon_id" IS NOT NULL THEN
    SELECT c."max_redemptions", c."code" INTO v_max, v_code FROM public."coupons" c WHERE c."id" = s."coupon_id" FOR UPDATE;
    IF v_max IS NOT NULL THEN
      SELECT pg_catalog.count(*)::integer INTO v_used FROM public."coupon_redemptions" r
      WHERE r."coupon_id" = s."coupon_id" AND r."charge_id" <> s."id";
      v_over := v_used >= v_max;
    END IF;
    INSERT INTO public."coupon_redemptions" ("tenant_id", "coupon_id", "charge_id", "discount_amount", "over_cap")
    VALUES (s."tenant_id", s."coupon_id", s."id", s."discount_amount", v_over)
    ON CONFLICT ("charge_id") DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_over AND v_count > 0 THEN
      INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff")
      VALUES (NULL, 'coupon.redemption_over_cap', s."tenant_id", pg_catalog.jsonb_build_object(
        'couponId', s."coupon_id", 'code', v_code, 'chargeId', s."id", 'maxRedemptions', v_max, 'redeemedBefore', v_used,
        'discountAmount', s."discount_amount"::text));
    END IF;
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

-- Same as 0071 plus `over_cap` (return type changes: drop + create).
DROP FUNCTION public."platform_coupon_redemptions"(uuid, uuid);--> statement-breakpoint
CREATE FUNCTION public."platform_coupon_redemptions"(p_actor uuid, p_coupon_id uuid)
RETURNS TABLE (
  redemption_id uuid, tenant_id uuid, tenant_name text, charge_id uuid, plan text, discount_amount text, free_days integer,
  price_amount text, created_at timestamptz, over_cap boolean
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
           s."price_amount"::text, r."created_at", r."over_cap"
    FROM public."coupon_redemptions" r
    JOIN public."tenants" t ON t."id" = r."tenant_id"
    JOIN public."subscription_charges" s ON s."id" = r."charge_id"
    WHERE r."coupon_id" = p_coupon_id
    ORDER BY r."created_at" DESC, r."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."subscription_charge_paid_hook_internal"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_coupon_redemptions"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."platform_coupon_redemptions"(uuid, uuid) TO crmwsp_app;
  END IF;
END
$$;
