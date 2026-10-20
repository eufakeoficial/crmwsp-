-- Row Level Security for AI, knowledge and usage tables (ADR 0002).
-- Standard tenant_isolation policy (FOR ALL, USING + WITH CHECK).
ALTER TABLE "llm_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "llm_connections"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "agent_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_configs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agent_configs"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "knowledge_sources"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "knowledge_chunks"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "ai_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_actions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_actions"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- action_approvals and usage_ledger: append-only for the runtime role (SELECT + INSERT only),
-- same pattern as audit_events.
ALTER TABLE "action_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_approvals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "action_approvals"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_insert" ON "action_approvals"
  FOR INSERT
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "usage_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_ledger" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "usage_ledger"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_insert" ON "usage_ledger"
  FOR INSERT
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- System (owner) policies, see 0005 and ADR 0002 ("system_owner").
DO $$
DECLARE
  t text;
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH t IN ARRAY ARRAY['llm_connections', 'agent_configs', 'knowledge_sources', 'knowledge_chunks', 'ai_actions', 'action_approvals', 'usage_ledger']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
  END LOOP;
END
$$;--> statement-breakpoint

-- Defense in depth on top of RLS: no UPDATE/DELETE/TRUNCATE on append-only tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON public."action_approvals" FROM crmwsp_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON public."usage_ledger" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Monthly spend of the CURRENT tenant, grouped by currency and kind.
-- SECURITY INVOKER: it reads usage_ledger under the caller's RLS, so with the
-- app role it only sums rows of app.tenant_id (0 rows without tenant).
-- p_month: any timestamp inside the month (truncated in UTC).
CREATE FUNCTION public."tenant_monthly_spend"(p_month timestamptz)
RETURNS TABLE (currency char(3), kind public."usage_kind", cost_minor numeric, quantity numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT u."currency", u."kind", pg_catalog.sum(u."cost_minor"), pg_catalog.sum(u."quantity")
  FROM public."usage_ledger" u
  WHERE u."occurred_at" >= pg_catalog.date_trunc('month', p_month, 'UTC')
    AND u."occurred_at" < pg_catalog.date_trunc('month', p_month, 'UTC') + interval '1 month'
  GROUP BY u."currency", u."kind"
  ORDER BY u."currency", u."kind";
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_monthly_spend"(timestamptz) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."tenant_monthly_spend"(timestamptz) TO crmwsp_app;
  END IF;
END
$$;
