-- Row Level Security for sales_playbooks (ADR 0002), same conventions as 0033.
ALTER TABLE "sales_playbooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_playbooks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_playbooks"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DO $$
DECLARE
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  SELECT pg_get_userbyid(c.relowner) INTO v_owner
  FROM pg_class c WHERE c.oid = 'public.sales_playbooks'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public.sales_playbooks AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
END
$$;
