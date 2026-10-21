-- Row Level Security for the owner-mode tables (F9, ADR 0002), same conventions as 0022/0035.
ALTER TABLE "owner_phones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_phones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "owner_phones"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "owner_commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_commands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "owner_commands"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "ai_pauses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_pauses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_pauses"
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
  FOREACH t IN ARRAY ARRAY['owner_phones', 'owner_commands', 'ai_pauses']
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
    -- Owner commands are the audit trail of what was asked from WhatsApp: never deleted by the app role.
    REVOKE DELETE, TRUNCATE ON public."owner_commands" FROM crmwsp_app;
  END IF;
END
$$;
