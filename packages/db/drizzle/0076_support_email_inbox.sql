-- Platform email inbox for contacto@vendemas.chat (ADR 0020), on top of support tickets (0075).
-- Renumbered from 0075 to 0076 when merged into feat/integracion (support tickets became 0075).
--  * 'resend' joins the inbound_events provider enum: `email.received` webhooks land there first
--    (dedupe_key resend:{email_id}, tenant_id NULL); the worker turns them into tickets.
--  * support_tickets gets channel ('app' | 'email'); tenant_id becomes nullable ONLY for external
--    email tickets (CHECK). The tenant_isolation policies compare tenant_id with app.tenant_id, so
--    NULL rows are never visible to the app role (NULL = x is not true).
--  * Writes happen only through SECURITY DEFINER functions (same conventions as 0075).
ALTER TYPE "public"."channel_provider" ADD VALUE IF NOT EXISTS 'resend';--> statement-breakpoint

ALTER TABLE "support_tickets" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "channel" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "subject_norm" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_channel_check" CHECK ("channel" IN ('app', 'email'));--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_required" CHECK ("tenant_id" IS NOT NULL OR "channel" = 'email');--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_contact_email_check" CHECK ("channel" <> 'email' OR ("contact_email" IS NOT NULL AND char_length("contact_email") <= 254));--> statement-breakpoint
CREATE INDEX "support_tickets_email_contact_idx" ON "support_tickets" USING btree ("contact_email","last_message_at") WHERE "channel" = 'email';--> statement-breakpoint

ALTER TABLE "support_messages" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "from_email" text;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "to_emails" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "email_message_id" text;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "resend_email_id" text;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "auto_reason" text;--> statement-breakpoint
ALTER TABLE "support_messages" DROP CONSTRAINT "support_messages_author_type_check";--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_type_check" CHECK ("author_type" IN ('tenant_user', 'platform_admin', 'email_contact'));--> statement-breakpoint
ALTER TABLE "support_messages" DROP CONSTRAINT "support_messages_body_len";--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_body_len" CHECK (
  char_length("body") BETWEEN 1 AND 5000
  OR ("email_message_id" IS NOT NULL AND char_length("body") BETWEEN 1 AND 200000)
);--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_html_len" CHECK ("html" IS NULL OR char_length("html") <= 500000);--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_resend_email_idx" ON "support_messages" USING btree ("resend_email_id") WHERE "resend_email_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_messages_email_message_idx" ON "support_messages" USING btree ("email_message_id") WHERE "email_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_messages_from_email_idx" ON "support_messages" USING btree ("from_email","created_at") WHERE "from_email" IS NOT NULL;--> statement-breakpoint

-- Tenant RLS on email messages of a tenant ticket: the app role may only insert tenant_user
-- messages (policy from 0075), so email_contact rows are written by the functions below only.

-- Webhook ingestion (API, app role). Signature already verified by the caller.
CREATE FUNCTION public."ingest_resend_event"(p_dedupe_key text, p_payload jsonb)
RETURNS TABLE (event_id uuid, inserted boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_event_id uuid;
BEGIN
  IF p_dedupe_key IS NULL OR p_payload IS NULL OR pg_catalog.length(p_dedupe_key) > 256 OR p_dedupe_key NOT LIKE 'resend:%' THEN
    RAISE EXCEPTION 'ingest_resend_event: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.octet_length(p_payload::text) > 262144 THEN
    RAISE EXCEPTION 'ingest_resend_event: payload too large' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public."inbound_events" ("tenant_id", "provider", "dedupe_key", "channel_connection_id", "payload", "signature_valid")
  VALUES (NULL, 'resend'::public."channel_provider", p_dedupe_key, NULL, p_payload, true)
  ON CONFLICT ("provider", "dedupe_key") DO NOTHING
  RETURNING "id" INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    RETURN QUERY SELECT v_event_id, true;
    RETURN;
  END IF;
  SELECT e."id" INTO v_event_id FROM public."inbound_events" e
  WHERE e."provider" = 'resend'::public."channel_provider" AND e."dedupe_key" = p_dedupe_key;
  RETURN QUERY SELECT v_event_id, false;
END
$fn$;--> statement-breakpoint

-- Worker: read / mark one resend event (tenant-less rows are invisible through RLS).
CREATE FUNCTION public."resend_event_get"(p_event_id uuid)
RETURNS TABLE (payload jsonb, processed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT e."payload", e."processed_at" FROM public."inbound_events" e
  WHERE e."id" = p_event_id AND e."provider" = 'resend'::public."channel_provider";
$fn$;--> statement-breakpoint

CREATE FUNCTION public."resend_event_mark"(p_event_id uuid, p_error text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  UPDATE public."inbound_events" SET "processed_at" = pg_catalog.now(), "error" = pg_catalog.left(p_error, 200)
  WHERE "id" = p_event_id AND "provider" = 'resend'::public."channel_provider";
$fn$;--> statement-breakpoint

-- Worker: store one received email as a ticket message (threading + per-sender rate limit).
-- Threading order: Message-ID in In-Reply-To/References -> [Ticket #n] token from the same sender
-- -> same sender + normalized subject within 30 days -> new ticket. A sender that matches a user
-- lands under that user's most recent active tenant; otherwise the ticket is external (no tenant).
-- Auto-generated mail (p_auto_reason) is stored but never reopens a ticket.
CREATE FUNCTION public."support_email_ingest"(
  p_resend_email_id text, p_message_id text, p_refs text[], p_from_email text, p_from_name text, p_to text[],
  p_subject text, p_subject_norm text, p_ticket_number integer, p_text text, p_html text, p_attachments jsonb,
  p_auto_reason text
)
RETURNS TABLE (ticket_id uuid, tenant_id uuid, message_id uuid, created boolean, outcome text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_ticket public."support_tickets"%ROWTYPE;
  v_found boolean := false;
  v_user uuid;
  v_tenant uuid;
  v_msg uuid;
  v_created boolean := false;
  v_body text;
BEGIN
  IF p_resend_email_id IS NULL OR pg_catalog.length(p_resend_email_id) > 128
     OR p_from_email IS NULL OR pg_catalog.length(p_from_email) > 254 OR p_from_email !~ '^[^\s@]+@[^\s@]+$'
     OR pg_catalog.coalesce(pg_catalog.array_length(p_refs, 1), 0) > 50
     OR pg_catalog.coalesce(pg_catalog.array_length(p_to, 1), 0) > 50
     OR (p_message_id IS NOT NULL AND pg_catalog.length(p_message_id) > 256)
     OR (p_auto_reason IS NOT NULL AND p_auto_reason NOT IN ('auto_submitted', 'precedence', 'bounce', 'list')) THEN
    RAISE EXCEPTION 'support_email_ingest: invalid argument' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public."support_messages" m WHERE m."resend_email_id" = p_resend_email_id)
     OR (p_message_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public."support_messages" m WHERE m."email_message_id" = p_message_id AND m."author_type" = 'email_contact')) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, false, 'duplicate'::text;
    RETURN;
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public."support_messages" m
      WHERE m."from_email" = p_from_email AND m."author_type" = 'email_contact'
        AND m."created_at" > pg_catalog.now() - interval '1 hour') >= 20 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, false, 'rate_limited'::text;
    RETURN;
  END IF;

  IF pg_catalog.coalesce(pg_catalog.array_length(p_refs, 1), 0) > 0 THEN
    SELECT s.* INTO v_ticket FROM public."support_messages" m
    JOIN public."support_tickets" s ON s."id" = m."ticket_id"
    WHERE m."email_message_id" = ANY (p_refs) AND s."channel" = 'email'
    ORDER BY m."created_at" DESC LIMIT 1 FOR UPDATE OF s;
    v_found := FOUND;
  END IF;
  IF NOT v_found AND p_ticket_number IS NOT NULL THEN
    SELECT s.* INTO v_ticket FROM public."support_tickets" s
    WHERE s."number" = p_ticket_number AND s."channel" = 'email' AND s."contact_email" = p_from_email
    FOR UPDATE;
    v_found := FOUND;
  END IF;
  IF NOT v_found AND pg_catalog.coalesce(p_subject_norm, '') <> '' THEN
    SELECT s.* INTO v_ticket FROM public."support_tickets" s
    WHERE s."channel" = 'email' AND s."contact_email" = p_from_email AND s."subject_norm" = p_subject_norm
      AND s."last_message_at" > pg_catalog.now() - interval '30 days'
    ORDER BY s."last_message_at" DESC LIMIT 1 FOR UPDATE;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    SELECT u."id", m."tenant_id" INTO v_user, v_tenant
    FROM public."users" u
    JOIN public."memberships" m ON m."user_id" = u."id"
    JOIN public."tenants" t ON t."id" = m."tenant_id"
    WHERE pg_catalog.lower(u."email") = p_from_email AND t."status" = 'active'
    ORDER BY m."created_at" DESC LIMIT 1;
    INSERT INTO public."support_tickets" ("tenant_id", "channel", "subject", "category", "created_by",
                                          "contact_email", "contact_name", "subject_norm", "admin_unread")
    VALUES (v_tenant, 'email',
            pg_catalog.coalesce(NULLIF(pg_catalog.left(pg_catalog.btrim(p_subject), 160), ''), '(sin asunto)'),
            'other', v_user, p_from_email, pg_catalog.left(p_from_name, 120), pg_catalog.left(p_subject_norm, 200), true)
    RETURNING * INTO v_ticket;
    v_created := true;
  END IF;

  v_body := pg_catalog.left(pg_catalog.coalesce(NULLIF(pg_catalog.btrim(p_text), ''), '(sin texto)'), 200000);
  INSERT INTO public."support_messages" ("tenant_id", "ticket_id", "author_type", "author_user_id", "body", "internal",
                                         "from_email", "to_emails", "email_message_id", "resend_email_id", "html",
                                         "attachments", "auto_reason")
  VALUES (v_ticket."tenant_id", v_ticket."id", 'email_contact', v_ticket."created_by", v_body, false,
          p_from_email, pg_catalog.coalesce(p_to, '{}'),
          pg_catalog.coalesce(p_message_id, '<' || p_resend_email_id || '@resend.inbound>'), p_resend_email_id,
          CASE WHEN pg_catalog.length(p_html) <= 500000 THEN p_html ELSE NULL END,
          pg_catalog.coalesce(p_attachments, '[]'::jsonb), p_auto_reason)
  RETURNING "id" INTO v_msg;

  UPDATE public."support_tickets" s
  SET "admin_unread" = true,
      "last_message_at" = pg_catalog.now(),
      "updated_at" = pg_catalog.now(),
      "status" = CASE WHEN p_auto_reason IS NULL AND s."status" IN ('waiting_customer', 'resolved') THEN 'open' ELSE s."status" END,
      "resolved_at" = CASE WHEN p_auto_reason IS NULL AND s."status" IN ('waiting_customer', 'resolved') THEN NULL ELSE s."resolved_at" END
  WHERE s."id" = v_ticket."id";

  RETURN QUERY SELECT v_ticket."id", v_ticket."tenant_id", v_msg, v_created, 'stored'::text;
END
$fn$;--> statement-breakpoint

-- Backoffice: email threads by folder (inbox | mine | resolved | sent). At most 500 rows.
CREATE FUNCTION public."platform_email_list"(p_actor uuid, p_folder text, p_ticket_id uuid DEFAULT NULL)
RETURNS TABLE (
  ticket_id uuid, number integer, subject text, status text, priority text, contact_email text, contact_name text,
  tenant_id uuid, tenant_name text, assignee_id uuid, assignee_name text, snippet text, admin_unread boolean,
  last_message_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_folder NOT IN ('inbox', 'mine', 'resolved', 'sent') THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT s."id", s."number", s."subject", s."status", s."priority", s."contact_email", s."contact_name",
           s."tenant_id", t."name", s."assignee_id", au."name",
           pg_catalog.coalesce((SELECT pg_catalog.left(m."body", 160) FROM public."support_messages" m
                                WHERE m."ticket_id" = s."id" AND NOT m."internal"
                                ORDER BY m."created_at" DESC, m."id" DESC LIMIT 1), ''),
           s."admin_unread", s."last_message_at"
    FROM public."support_tickets" s
    LEFT JOIN public."tenants" t ON t."id" = s."tenant_id"
    LEFT JOIN public."users" au ON au."id" = s."assignee_id"
    WHERE s."channel" = 'email'
      AND (p_ticket_id IS NULL OR s."id" = p_ticket_id)
      AND (p_ticket_id IS NOT NULL
           OR (p_folder = 'inbox' AND s."status" <> 'resolved')
           OR (p_folder = 'mine' AND s."assignee_id" = p_actor AND s."status" <> 'resolved')
           OR (p_folder = 'resolved' AND s."status" = 'resolved')
           OR (p_folder = 'sent' AND EXISTS (SELECT 1 FROM public."support_messages" m
                                             WHERE m."ticket_id" = s."id" AND m."author_type" = 'platform_admin' AND NOT m."internal")))
    ORDER BY s."last_message_at" DESC, s."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Backoffice: messages of one email thread (internal notes included).
CREATE FUNCTION public."platform_email_messages"(p_actor uuid, p_ticket_id uuid)
RETURNS TABLE (
  message_id uuid, author_type text, author_name text, from_email text, to_emails text[], body text, html text,
  attachments jsonb, internal boolean, auto_reason text, email_message_id text, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT m."id", m."author_type", u."name", m."from_email", m."to_emails", m."body", m."html", m."attachments",
           m."internal", m."auto_reason", m."email_message_id", m."created_at"
    FROM public."support_messages" m
    JOIN public."support_tickets" s ON s."id" = m."ticket_id" AND s."channel" = 'email'
    LEFT JOIN public."users" u ON u."id" = m."author_user_id"
    WHERE m."ticket_id" = p_ticket_id
    ORDER BY m."created_at", m."id"
    LIMIT 1000;
END
$fn$;--> statement-breakpoint

CREATE FUNCTION public."platform_email_unread_count"(p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN (SELECT pg_catalog.count(*)::integer FROM public."support_tickets" s
          WHERE s."channel" = 'email' AND s."admin_unread" AND s."status" <> 'resolved');
END
$fn$;--> statement-breakpoint

-- Records an email sent by an admin (after the mailer accepted it). p_ticket_id NULL = new
-- outbound thread to p_to (tenant resolved like inbound). Audited.
CREATE FUNCTION public."platform_email_record_outbound"(
  p_actor uuid, p_ticket_id uuid, p_to text, p_subject text, p_body text, p_message_id text, p_ip inet
)
RETURNS TABLE (ticket_id uuid, tenant_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_ticket public."support_tickets"%ROWTYPE;
  v_user uuid;
  v_tenant uuid;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_to IS NULL OR pg_catalog.length(p_to) > 254 OR p_to !~ '^[^\s@]+@[^\s@]+$'
     OR p_message_id IS NULL OR pg_catalog.length(p_message_id) > 256 THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF p_ticket_id IS NULL THEN
    SELECT u."id", m."tenant_id" INTO v_user, v_tenant
    FROM public."users" u
    JOIN public."memberships" m ON m."user_id" = u."id"
    JOIN public."tenants" t ON t."id" = m."tenant_id"
    WHERE pg_catalog.lower(u."email") = pg_catalog.lower(p_to) AND t."status" = 'active'
    ORDER BY m."created_at" DESC LIMIT 1;
    INSERT INTO public."support_tickets" ("tenant_id", "channel", "subject", "category", "created_by", "contact_email",
                                          "subject_norm", "status", "admin_unread", "assignee_id")
    VALUES (v_tenant, 'email', pg_catalog.left(p_subject, 160), 'other', v_user, pg_catalog.lower(p_to),
            pg_catalog.lower(pg_catalog.left(p_subject, 200)), 'waiting_customer', false, p_actor)
    RETURNING * INTO v_ticket;
  ELSE
    SELECT * INTO v_ticket FROM public."support_tickets" s WHERE s."id" = p_ticket_id AND s."channel" = 'email' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'platform: ticket not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public."support_tickets" s
    SET "status" = CASE WHEN s."status" = 'resolved' THEN s."status" ELSE 'waiting_customer' END,
        "admin_unread" = false,
        "tenant_unread" = s."tenant_id" IS NOT NULL,
        "last_message_at" = pg_catalog.now(),
        "updated_at" = pg_catalog.now()
    WHERE s."id" = v_ticket."id";
  END IF;
  INSERT INTO public."support_messages" ("tenant_id", "ticket_id", "author_type", "author_user_id", "body", "internal",
                                         "from_email", "to_emails", "email_message_id")
  VALUES (v_ticket."tenant_id", v_ticket."id", 'platform_admin', p_actor, pg_catalog.left(p_body, 200000), false,
          'contacto@vendemas.chat', ARRAY[pg_catalog.lower(p_to)], p_message_id);
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'support.email_send', v_ticket."tenant_id",
          pg_catalog.jsonb_build_object('ticketId', v_ticket."id", 'to', pg_catalog.lower(p_to), 'new', p_ticket_id IS NULL), p_ip);
  RETURN QUERY SELECT v_ticket."id", v_ticket."tenant_id";
END
$fn$;--> statement-breakpoint

-- The 0075 support inbox and its badge keep showing app tickets only (email has its own inbox).
CREATE OR REPLACE FUNCTION public."platform_support_ticket_list"(
  p_actor uuid, p_status text, p_priority text, p_category text, p_tenant_id uuid, p_assigned text, p_ticket_id uuid DEFAULT NULL
)
RETURNS TABLE (
  ticket_id uuid, number integer, tenant_id uuid, tenant_name text, subject text, category text, priority text,
  status text, created_by uuid, creator_name text, creator_email text, assignee_id uuid, assignee_name text,
  tenant_unread boolean, admin_unread boolean, last_message_at timestamptz, created_at timestamptz, resolved_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_assigned IS NOT NULL AND p_assigned NOT IN ('me', 'none') THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT s."id", s."number", s."tenant_id", t."name", s."subject", s."category", s."priority", s."status",
           s."created_by", cu."name", cu."email", s."assignee_id", au."name",
           s."tenant_unread", s."admin_unread", s."last_message_at", s."created_at", s."resolved_at"
    FROM public."support_tickets" s
    JOIN public."tenants" t ON t."id" = s."tenant_id"
    LEFT JOIN public."users" cu ON cu."id" = s."created_by"
    LEFT JOIN public."users" au ON au."id" = s."assignee_id"
    WHERE s."channel" = 'app'
      AND (p_ticket_id IS NULL OR s."id" = p_ticket_id)
      AND (p_status IS NULL OR s."status" = p_status)
      AND (p_priority IS NULL OR s."priority" = p_priority)
      AND (p_category IS NULL OR s."category" = p_category)
      AND (p_tenant_id IS NULL OR s."tenant_id" = p_tenant_id)
      AND (p_assigned IS NULL OR (p_assigned = 'me' AND s."assignee_id" = p_actor) OR (p_assigned = 'none' AND s."assignee_id" IS NULL))
    ORDER BY s."last_message_at" DESC, s."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public."platform_support_unread_count"(p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN (SELECT pg_catalog.count(*)::integer FROM public."support_tickets" s WHERE s."channel" = 'app' AND s."admin_unread" AND s."status" <> 'resolved');
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."ingest_resend_event"(text, jsonb) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."resend_event_get"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."resend_event_mark"(uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."support_email_ingest"(text, text, text[], text, text, text[], text, text, integer, text, text, jsonb, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_email_list"(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_email_messages"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_email_unread_count"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_email_record_outbound"(uuid, uuid, text, text, text, text, inet) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."ingest_resend_event"(text, jsonb) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."resend_event_get"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."resend_event_mark"(uuid, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."support_email_ingest"(text, text, text[], text, text, text[], text, text, integer, text, text, jsonb, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_email_list"(uuid, text, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_email_messages"(uuid, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_email_unread_count"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_email_record_outbound"(uuid, uuid, text, text, text, text, inet) TO crmwsp_app;
  END IF;
END
$$;
--> statement-breakpoint

-- Worker: public platform replies on APP tickets in the last p_hours not yet emailed to the ticket
-- creator ("ticket-respuesta" template). Internal notes and email-channel tickets are excluded
-- (email tickets are answered by email directly). Dedupe key: 'support-reply:' || message id.
CREATE FUNCTION public."email_recent_support_replies"(p_hours integer, p_limit integer)
RETURNS TABLE (
  message_id uuid, tenant_id uuid, ticket_number integer, ticket_subject text,
  creator_email text, creator_name text, agent_name text, body text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT m."id", m."tenant_id", t."number", t."subject", cu."email", cu."name", au."name", m."body"
  FROM public."support_messages" m
  JOIN public."support_tickets" t ON t."id" = m."ticket_id" AND t."tenant_id" = m."tenant_id"
  JOIN public."users" cu ON cu."id" = t."created_by"
  LEFT JOIN public."users" au ON au."id" = m."author_user_id"
  WHERE m."author_type" = 'platform_admin' AND NOT m."internal" AND m."auto_reason" IS NULL
    AND t."channel" = 'app' AND t."tenant_id" IS NOT NULL
    AND m."created_at" > pg_catalog.now() - pg_catalog.make_interval(hours => LEAST(GREATEST(coalesce(p_hours, 48), 1), 168))
    AND NOT EXISTS (SELECT 1 FROM public."email_dispatches" d WHERE d."dedupe_key" = 'support-reply:' || m."id"::text)
  ORDER BY m."created_at"
  LIMIT LEAST(GREATEST(coalesce(p_limit, 100), 1), 500);
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."email_recent_support_replies"(integer, integer) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."email_recent_support_replies"(integer, integer) TO crmwsp_app;
  END IF;
END
$$;
