-- Row Level Security for messaging tables (ADR 0002).
-- Standard tenant_isolation policy (FOR ALL, USING + WITH CHECK).
ALTER TABLE "channel_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "channel_connections"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversations"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "messages"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attachments"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- audit_events: append-only for the runtime role (SELECT + INSERT only).
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "audit_events"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_insert" ON "audit_events"
  FOR INSERT
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- inbound_events: the runtime role may read and update (processed_at, error)
-- rows of its tenant. Rows with tenant_id NULL are invisible. No INSERT or
-- DELETE policy: ingestion only goes through ingest_inbound_event() below.
ALTER TABLE "inbound_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "inbound_events"
  FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_update" ON "inbound_events"
  FOR UPDATE
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- System (owner) policies. In production the migrator role is NOT a
-- superuser and has NOBYPASSRLS (managed Postgres: RDS, Neon, Supabase), so
-- with FORCE ROW LEVEL SECURITY the table owner is subject to RLS too. The
-- owner (= migrator, which also owns ingest_inbound_event) gets an explicit
-- permissive policy scoped TO that role only. This grants nothing new: an
-- owner can always ALTER TABLE ... NO FORCE ROW LEVEL SECURITY. Policies are
-- per role, so crmwsp_app gains no path unless it is a member of the owner
-- role, which is rejected below.
DO $$
DECLARE
  t text;
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH t IN ARRAY ARRAY['tenants', 'memberships', 'users', 'channel_connections', 'contacts',
                           'conversations', 'messages', 'attachments', 'audit_events', 'inbound_events']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
  END LOOP;
END
$$;--> statement-breakpoint

-- Defense in depth on top of RLS: the runtime role never gets UPDATE/DELETE/
-- TRUNCATE on audit_events, nor INSERT/DELETE/TRUNCATE on inbound_events.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON public."audit_events" FROM crmwsp_app;
    REVOKE INSERT, DELETE, TRUNCATE ON public."inbound_events" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Webhook ingestion. SECURITY DEFINER (owned by the migrator role) so the
-- runtime role needs no "without tenant" path:
--   * resolves the connection ONLY by (provider, webhook_token); a disabled or
--     unknown connection inserts nothing and returns no row;
--   * tenant_id and channel_connection_id come from the connection, never
--     from the caller;
--   * idempotent via ON CONFLICT (provider, dedupe_key) DO NOTHING;
--   * on conflict it only reveals the existing event id if that event belongs
--     to the same connection (no cross-tenant probing by dedupe_key);
--   * fixed search_path (pg_temp last) and schema-qualified objects; EXECUTE
--     revoked from PUBLIC, granted to crmwsp_app;
--   * payload capped at 1 MiB; error messages never include data;
--   * works without superuser/BYPASSRLS: as the owner it is covered by the
--     "system_owner" policies above. It deliberately does NOT call
--     set_config('app.tenant_id', ..., true): that would leak into the
--     caller's transaction.
CREATE FUNCTION public."ingest_inbound_event"(
  p_provider public."channel_provider",
  p_webhook_token text,
  p_dedupe_key text,
  p_payload jsonb,
  p_signature_valid boolean
)
RETURNS TABLE (event_id uuid, tenant_id uuid, inserted boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_conn_id uuid;
  v_tenant_id uuid;
  v_event_id uuid;
BEGIN
  IF p_provider IS NULL OR p_webhook_token IS NULL OR p_dedupe_key IS NULL
     OR p_payload IS NULL OR p_signature_valid IS NULL THEN
    RAISE EXCEPTION 'ingest_inbound_event: arguments must not be null' USING ERRCODE = '22004';
  END IF;
  IF pg_catalog.length(p_webhook_token) = 0 OR pg_catalog.length(p_webhook_token) > 256
     OR pg_catalog.length(p_dedupe_key) = 0 OR pg_catalog.length(p_dedupe_key) > 512 THEN
    RAISE EXCEPTION 'ingest_inbound_event: invalid token or dedupe key length' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.octet_length(p_payload::text) > 1048576 THEN
    RAISE EXCEPTION 'ingest_inbound_event: payload too large' USING ERRCODE = '54000';
  END IF;

  SELECT c."id", c."tenant_id" INTO v_conn_id, v_tenant_id
  FROM public."channel_connections" c
  WHERE c."webhook_token" = p_webhook_token
    AND c."provider" = p_provider
    AND c."status" <> 'disabled';
  IF v_conn_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public."inbound_events"
    ("tenant_id", "provider", "dedupe_key", "channel_connection_id", "payload", "signature_valid")
  VALUES (v_tenant_id, p_provider, p_dedupe_key, v_conn_id, p_payload, p_signature_valid)
  ON CONFLICT ("provider", "dedupe_key") DO NOTHING
  RETURNING "id" INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    RETURN QUERY SELECT v_event_id, v_tenant_id, true;
    RETURN;
  END IF;

  SELECT e."id" INTO v_event_id
  FROM public."inbound_events" e
  WHERE e."provider" = p_provider
    AND e."dedupe_key" = p_dedupe_key
    AND e."channel_connection_id" = v_conn_id;
  RETURN QUERY SELECT v_event_id, v_tenant_id, false;
END;
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."ingest_inbound_event"(public."channel_provider", text, text, jsonb, boolean) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."ingest_inbound_event"(public."channel_provider", text, text, jsonb, boolean) TO crmwsp_app;
  END IF;
END
$$;
