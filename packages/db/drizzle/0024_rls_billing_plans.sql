-- Row Level Security for the billing tables (ADR 0002), same conventions as 0022.
-- tenant_plans is READ-ONLY for the app role: a tenant must never change its own plan.
-- usage_counters: select/insert/update for the app role (upsert increments), never delete.
ALTER TABLE "tenant_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "tenant_plans"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "usage_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "usage_counters"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_insert" ON "usage_counters"
  FOR INSERT
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_update" ON "usage_counters"
  FOR UPDATE
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DO $$
DECLARE
  t text;
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH t IN ARRAY ARRAY['tenant_plans', 'usage_counters']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
  END LOOP;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public."tenant_plans" FROM crmwsp_app;
    REVOKE DELETE, TRUNCATE ON public."usage_counters" FROM crmwsp_app;
  END IF;
END
$$;
