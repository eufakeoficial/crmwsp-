-- Platform backoffice "Finanzas" (ADR 0018): revenue from OUR settled subscription charges.
-- Read-only, aggregated, admins only (platform_assert_admin_internal). Coupon grants (price 0)
-- are counted apart; refunded charges are excluded from revenue.

-- One row per (bucket, key): bucket in 'today' | 'month' | 'plan' | 'period' | 'pay_currency' | 'coupon_grants'.
-- usd = sum of price_amount (USD) of paid charges; crypto = sum of actually_paid (pay_currency
-- only); n = number of charges. Dates are UTC.
CREATE FUNCTION public."platform_finance_summary"(p_actor uuid)
RETURNS TABLE (bucket text, key text, usd text, crypto text, n integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
  WITH paid AS (
    SELECT s."plan", s."period_days", s."price_amount", s."actually_paid", s."pay_currency", s."paid_at"
    FROM public."subscription_charges" s
    WHERE s."status" = 'paid' AND s."verified_by" IN ('webhook', 'reconciliation')
  )
  SELECT 'today'::text, ''::text, coalesce(pg_catalog.sum(p."price_amount"), 0)::text, NULL::text, pg_catalog.count(*)::integer
  FROM paid p WHERE (p."paid_at" AT TIME ZONE 'UTC')::date = (pg_catalog.now() AT TIME ZONE 'UTC')::date
  UNION ALL
  SELECT 'month', '', coalesce(pg_catalog.sum(p."price_amount"), 0)::text, NULL, pg_catalog.count(*)::integer
  FROM paid p WHERE pg_catalog.date_trunc('month', p."paid_at" AT TIME ZONE 'UTC') = pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'UTC')
  UNION ALL
  SELECT 'plan', p."plan", pg_catalog.sum(p."price_amount")::text, NULL, pg_catalog.count(*)::integer FROM paid p GROUP BY p."plan"
  UNION ALL
  SELECT 'period', CASE p."period_days" WHEN 365 THEN 'annual' ELSE 'monthly' END, pg_catalog.sum(p."price_amount")::text, NULL,
         pg_catalog.count(*)::integer
  FROM paid p GROUP BY 2
  UNION ALL
  SELECT 'pay_currency', p."pay_currency", pg_catalog.sum(p."price_amount")::text, coalesce(pg_catalog.sum(p."actually_paid"), 0)::text,
         pg_catalog.count(*)::integer
  FROM paid p GROUP BY p."pay_currency"
  UNION ALL
  SELECT 'coupon_grants', '', '0', NULL, pg_catalog.count(*)::integer
  FROM public."subscription_charges" s WHERE s."status" = 'paid' AND s."verified_by" = 'coupon';
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."platform_finance_summary"(uuid) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."platform_finance_summary"(uuid) TO crmwsp_app;
  END IF;
END
$$;
