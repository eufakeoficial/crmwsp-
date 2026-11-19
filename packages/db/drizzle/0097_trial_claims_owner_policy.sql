-- 0069 created trial_claims and tenant_signup_signals with FORCE ROW LEVEL SECURITY and no policy.
-- In production the migrator (owner of the SECURITY DEFINER functions) is NOT a superuser and has
-- NOBYPASSRLS, so the owner is subject to RLS too: trial_claims_insert_internal and
-- tenant_signup_signals_record failed with an RLS violation (channel activation returned 500 once
-- TRIAL_IDENTITY_SECRET was set, and signup signals were never recorded). Same "system_owner"
-- pattern as 0005: a permissive policy scoped TO the owner role only. crmwsp_app still has no
-- table privilege and no policy, so it gains no path.
DO $$
DECLARE
  t text;
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH t IN ARRAY ARRAY['trial_claims', 'tenant_signup_signals']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'system_owner') THEN
      EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
    END IF;
  END LOOP;
END
$$;
