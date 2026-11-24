-- 0071 enabled and FORCED row level security on "coupons" but never created a policy for it.
-- Under FORCE, the table owner is subject to RLS as well, so the SECURITY DEFINER functions that
-- run as that owner (platform_coupon_save/list/delete, coupon_lookup, ...) were denied: every
-- INSERT failed with 42501 (surfaced by the API as 404) and every SELECT returned zero rows.
-- Same owner-only policy that 0071 gave coupon_redemptions. The runtime role still has no direct
-- table privileges; it only reaches coupons through those functions.
DO $$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = 'public.coupons'::regclass;
  IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'coupons' AND p.policyname = 'system_owner') THEN
    EXECUTE format('CREATE POLICY "system_owner" ON public.coupons AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
  END IF;
END
$$;
