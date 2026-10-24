-- Channel quality and Meta account/template events (ADR 0021, T2d). Fed by the v3 webhook fields
-- phone_number_quality_update, account_update, message_template_status_update and
-- message_template_quality_update when the BSP forwards them. channel_quality_events is a tenant
-- table (RLS, same conventions as 0033); the platform reads it only through a definer function.

ALTER TABLE public."channel_connections"
  ADD COLUMN "quality_rating" text,
  ADD COLUMN "account_status" text NOT NULL DEFAULT 'ok',
  ADD COLUMN "messaging_limit" text,
  ADD COLUMN "quality_updated_at" timestamptz,
  ADD CONSTRAINT "channel_connections_quality_rating_check" CHECK ("quality_rating" IS NULL OR "quality_rating" IN ('GREEN', 'YELLOW', 'RED', 'UNKNOWN')),
  ADD CONSTRAINT "channel_connections_account_status_check" CHECK ("account_status" IN ('ok', 'flagged', 'restricted', 'disabled'));--> statement-breakpoint

CREATE TABLE public."channel_quality_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "channel_connection_id" uuid NOT NULL,
  "inbound_event_id" uuid,
  "field" text NOT NULL,
  "event" text,
  "quality" text,
  "messaging_limit" text,
  "template_name" text,
  "template_language" text,
  "reason" text,
  "severity" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "channel_quality_events_channel_fk" FOREIGN KEY ("tenant_id", "channel_connection_id")
    REFERENCES public."channel_connections"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "channel_quality_events_field_check" CHECK ("field" IN ('phone_number_quality_update', 'account_update', 'message_template_status_update', 'message_template_quality_update')),
  CONSTRAINT "channel_quality_events_severity_check" CHECK ("severity" IN ('info', 'warning', 'critical'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "channel_quality_events_tenant_id_id_idx" ON public."channel_quality_events" ("tenant_id", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_quality_events_inbound_event_unique" ON public."channel_quality_events" ("tenant_id", "inbound_event_id") WHERE "inbound_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_quality_events_channel_created_idx" ON public."channel_quality_events" ("tenant_id", "channel_connection_id", "created_at");--> statement-breakpoint
CREATE INDEX "channel_quality_events_created_idx" ON public."channel_quality_events" ("created_at");--> statement-breakpoint

ALTER TABLE public."channel_quality_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."channel_quality_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON public."channel_quality_events"
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
  FROM pg_class c WHERE c.oid = 'public.channel_quality_events'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public.channel_quality_events AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
END
$$;--> statement-breakpoint

-- Owner alert for a quality drop / restriction (panel + owner WhatsApp via the notification tick).
ALTER TABLE public."notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('order_confirmed', 'order_paid', 'handoff', 'approval_requested', 'payment_review', 'reminder', 'channel_quality'));--> statement-breakpoint

-- Backoffice: warning/critical channel events of the last p_days days across tenants. Only the
-- last 4 digits of the number; never message bodies, contacts or credentials.
CREATE FUNCTION public."platform_channel_quality_alerts"(p_actor uuid, p_days integer)
RETURNS TABLE (
  event_id uuid, tenant_id uuid, tenant_name text, channel_id uuid, provider text, phone_last4 text,
  field text, event text, quality text, reason text, severity text, account_status text, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF coalesce(p_days, 30) NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT e."id", e."tenant_id", t."name", c."id", c."provider"::text, pg_catalog.right(c."phone_e164", 4),
           e."field", e."event", e."quality", e."reason", e."severity", c."account_status", e."created_at"
    FROM public."channel_quality_events" e
    JOIN public."channel_connections" c ON c."tenant_id" = e."tenant_id" AND c."id" = e."channel_connection_id"
    JOIN public."tenants" t ON t."id" = e."tenant_id"
    WHERE e."severity" IN ('warning', 'critical')
      AND e."created_at" > pg_catalog.now() - pg_catalog.make_interval(days => coalesce(p_days, 30))
    ORDER BY e."created_at" DESC, e."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Worker only: e-mail addresses of platform admins for critical alerts (policy changes, restrictions).
-- There is no separate worker role, so the caller must open a transaction that sets
-- app.worker_scope = 'platform_alerts' and carries no tenant/user context. API requests always run
-- inside withTenant (app.tenant_id / app.user_id set) and never set app.worker_scope, so no API
-- path can read admin e-mails through this function (ADR 0021).
CREATE FUNCTION public."platform_alert_recipients"()
RETURNS TABLE (email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF coalesce(current_setting('app.worker_scope', true), '') <> 'platform_alerts'
     OR coalesce(current_setting('app.tenant_id', true), '') <> ''
     OR coalesce(current_setting('app.user_id', true), '') <> '' THEN
    RAISE EXCEPTION 'platform_alert_recipients is worker-only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u."email"::text FROM public."platform_admins" a JOIN public."users" u ON u."id" = a."user_id"
    ORDER BY a."created_at" LIMIT 20;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."platform_channel_quality_alerts"(uuid, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_alert_recipients"() FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."platform_channel_quality_alerts"(uuid, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_alert_recipients"() TO crmwsp_app;
  END IF;
END
$$;
