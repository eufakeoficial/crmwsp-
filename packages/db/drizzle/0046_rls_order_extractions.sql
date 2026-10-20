-- Row Level Security for order_extractions (ADR 0002), same conventions as 0035.
ALTER TABLE "order_extractions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_extractions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_extractions"
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
  FROM pg_class c WHERE c.oid = 'public.order_extractions'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public.order_extractions AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    -- Detected orders are an audit trail of what the customer asked for: never deleted by the app role.
    REVOKE DELETE, TRUNCATE ON public."order_extractions" FROM crmwsp_app;
  END IF;
END
$$;
