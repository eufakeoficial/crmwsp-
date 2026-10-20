-- Row Level Security for the payment tables (ADR 0002), same conventions as 0005/0014:
-- tenant_isolation, system_owner, and payment_events without DELETE/TRUNCATE for the app role.
ALTER TABLE "payment_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_connections"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "payment_events"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_insert" ON "payment_events"
  FOR INSERT
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_update" ON "payment_events"
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
  FOREACH t IN ARRAY ARRAY['payment_connections', 'payments', 'payment_events']
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
    REVOKE DELETE, TRUNCATE ON public."payment_events" FROM crmwsp_app;
    REVOKE TRUNCATE ON public."payments" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Webhook connection lookup. SECURITY DEFINER (owned by the migrator) so the runtime role needs
-- no "without tenant" path: resolves ONLY by (provider, webhook_token) of an active connection and
-- returns the tenant and the webhook-secret CIPHERTEXT (decrypted in the API with tenant-bound AAD).
-- Never returns the API key. No set_config (would leak into the caller's transaction).
CREATE FUNCTION public."resolve_payment_webhook"(p_provider text, p_webhook_token text)
RETURNS TABLE (tenant_id uuid, connection_id uuid, webhook_secret_encrypted bytea)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF p_provider IS NULL OR p_webhook_token IS NULL
     OR pg_catalog.length(p_webhook_token) = 0 OR pg_catalog.length(p_webhook_token) > 256 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT c."tenant_id", c."id", c."webhook_secret_encrypted"
    FROM public."payment_connections" c
    WHERE c."provider" = p_provider AND c."webhook_token" = p_webhook_token AND c."status" = 'active';
END
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."resolve_payment_webhook"(text, text) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."resolve_payment_webhook"(text, text) TO crmwsp_app;
  END IF;
END
$$;
