-- Support tickets (ADR 0016). support_tickets / support_messages are tenant tables (tenant_id +
-- RLS, composite FK). support_canned_responses is platform-level: no privileges for crmwsp_app.
-- The platform backoffice reaches tickets of every tenant only through the platform_support_*
-- SECURITY DEFINER functions below (same conventions as 0052/0057: migrator owner, fixed
-- search_path with pg_temp last, schema-qualified objects, EXECUTE only for crmwsp_app, every
-- function re-checks platform_admins and audits writes in platform_audit_events).
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"assignee_id" uuid,
	"tenant_unread" boolean DEFAULT false NOT NULL,
	"admin_unread" boolean DEFAULT true NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_number_unique" UNIQUE("number"),
	CONSTRAINT "support_tickets_subject_len" CHECK (char_length("subject") BETWEEN 1 AND 160),
	CONSTRAINT "support_tickets_category_check" CHECK ("category" IN ('billing', 'whatsapp', 'ai', 'bug', 'other')),
	CONSTRAINT "support_tickets_priority_check" CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "support_tickets_status_check" CHECK ("status" IN ('open', 'in_progress', 'waiting_customer', 'resolved')),
	CONSTRAINT "support_tickets_resolved_check" CHECK (("status" = 'resolved') = ("resolved_at" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_author_type_check" CHECK ("author_type" IN ('tenant_user', 'platform_admin')),
	CONSTRAINT "support_messages_body_len" CHECK (char_length("body") BETWEEN 1 AND 5000),
	CONSTRAINT "support_messages_internal_admin_only" CHECK (NOT "internal" OR "author_type" = 'platform_admin')
);--> statement-breakpoint
CREATE TABLE "support_canned_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_canned_title_len" CHECK (char_length("title") BETWEEN 1 AND 120),
	CONSTRAINT "support_canned_body_len" CHECK (char_length("body") BETWEEN 1 AND 5000)
);--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_canned_responses" ADD CONSTRAINT "support_canned_responses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_tenant_id_id_idx" ON "support_tickets" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "support_tickets_tenant_last_idx" ON "support_tickets" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "support_tickets_status_last_idx" ON "support_tickets" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" USING btree ("tenant_id","ticket_id","created_at");--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_tenant_ticket_fk" FOREIGN KEY ("tenant_id","ticket_id") REFERENCES "public"."support_tickets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Row Level Security (ADR 0002). support_messages: the app role never sees internal notes and can
-- only insert public tenant_user messages; platform_admin rows are written by the definer functions
-- (system_owner policy).
DO $$
DECLARE
  v_table text;
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH v_table IN ARRAY ARRAY['support_tickets', 'support_messages', 'support_canned_responses'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = format('public.%I', v_table)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_table, v_owner);
  END LOOP;
  CREATE POLICY "tenant_isolation" ON public."support_tickets"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  CREATE POLICY "tenant_isolation" ON public."support_messages"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND NOT "internal")
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                AND NOT "internal" AND "author_type" = 'tenant_user');
  -- support_canned_responses: RLS on, no policy for the app role.
END
$$;--> statement-breakpoint

REVOKE ALL ON TABLE public."support_canned_responses" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."support_canned_responses" FROM crmwsp_app;
    -- Messages are immutable for the app; tickets only change tenant-side workflow columns
    -- (never the assignee, priority, subject or tenant).
    REVOKE UPDATE, DELETE, TRUNCATE ON public."support_messages" FROM crmwsp_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON public."support_tickets" FROM crmwsp_app;
    GRANT UPDATE ("status", "tenant_unread", "admin_unread", "last_message_at", "resolved_at", "updated_at")
      ON public."support_tickets" TO crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Ticket rows across tenants (whitelisted columns; never other tenant data). At most 500 rows.
CREATE FUNCTION public."platform_support_ticket_list"(
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
    WHERE (p_ticket_id IS NULL OR s."id" = p_ticket_id)
      AND (p_status IS NULL OR s."status" = p_status)
      AND (p_priority IS NULL OR s."priority" = p_priority)
      AND (p_category IS NULL OR s."category" = p_category)
      AND (p_tenant_id IS NULL OR s."tenant_id" = p_tenant_id)
      AND (p_assigned IS NULL OR (p_assigned = 'me' AND s."assignee_id" = p_actor) OR (p_assigned = 'none' AND s."assignee_id" IS NULL))
    ORDER BY s."last_message_at" DESC, s."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Full thread of one ticket, internal notes included (admins only).
CREATE FUNCTION public."platform_support_messages"(p_actor uuid, p_ticket_id uuid)
RETURNS TABLE (message_id uuid, author_type text, author_name text, body text, internal boolean, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT m."id", m."author_type", u."name", m."body", m."internal", m."created_at"
    FROM public."support_messages" m
    LEFT JOIN public."users" u ON u."id" = m."author_user_id"
    WHERE m."ticket_id" = p_ticket_id
    ORDER BY m."created_at", m."id"
    LIMIT 1000;
END
$fn$;--> statement-breakpoint

CREATE FUNCTION public."platform_support_mark_read"(p_actor uuid, p_ticket_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  UPDATE public."support_tickets" SET "admin_unread" = false WHERE "id" = p_ticket_id AND "admin_unread";
END
$fn$;--> statement-breakpoint

-- Admin reply or internal note. Public reply: status -> waiting_customer (unless resolved) and the
-- tenant sees it as unread (mirrors statusAfterAdminReply in @crmwsp/domain). Audited.
CREATE FUNCTION public."platform_support_reply"(p_actor uuid, p_ticket_id uuid, p_body text, p_internal boolean, p_ip inet)
RETURNS TABLE (message_id uuid, tenant_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_ticket public."support_tickets"%ROWTYPE;
  v_id uuid;
  v_internal boolean := coalesce(p_internal, false);
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  SELECT * INTO v_ticket FROM public."support_tickets" s WHERE s."id" = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform: ticket not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public."support_messages" ("tenant_id", "ticket_id", "author_type", "author_user_id", "body", "internal")
  VALUES (v_ticket."tenant_id", v_ticket."id", 'platform_admin', p_actor, p_body, v_internal)
  RETURNING "id" INTO v_id;
  IF NOT v_internal THEN
    UPDATE public."support_tickets" s
    SET "status" = CASE WHEN s."status" = 'resolved' THEN s."status" ELSE 'waiting_customer' END,
        "tenant_unread" = true,
        "last_message_at" = pg_catalog.now(),
        "updated_at" = pg_catalog.now()
    WHERE s."id" = v_ticket."id";
  END IF;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'support.reply', v_ticket."tenant_id",
          pg_catalog.jsonb_build_object('ticketId', v_ticket."id", 'internal', v_internal), p_ip);
  RETURN QUERY SELECT v_id, v_ticket."tenant_id";
END
$fn$;--> statement-breakpoint

-- Status / priority / assignment (p_assign: 'me' | 'none' | NULL = unchanged). Audited with a diff.
CREATE FUNCTION public."platform_support_update"(p_actor uuid, p_ticket_id uuid, p_status text, p_priority text, p_assign text, p_ip inet)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_ticket public."support_tickets"%ROWTYPE;
  v_status text;
  v_priority text;
  v_assignee uuid;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_assign IS NOT NULL AND p_assign NOT IN ('me', 'none') THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ticket FROM public."support_tickets" s WHERE s."id" = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform: ticket not found' USING ERRCODE = 'P0002';
  END IF;
  v_status := coalesce(p_status, v_ticket."status");
  v_priority := coalesce(p_priority, v_ticket."priority");
  v_assignee := CASE p_assign WHEN 'me' THEN p_actor WHEN 'none' THEN NULL ELSE v_ticket."assignee_id" END;
  UPDATE public."support_tickets" s
  SET "status" = v_status,
      "priority" = v_priority,
      "assignee_id" = v_assignee,
      "resolved_at" = CASE WHEN v_status = 'resolved' THEN coalesce(s."resolved_at", pg_catalog.now()) ELSE NULL END,
      "updated_at" = pg_catalog.now()
  WHERE s."id" = v_ticket."id";
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'support.update', v_ticket."tenant_id",
          pg_catalog.jsonb_build_object(
            'ticketId', v_ticket."id",
            'status', pg_catalog.jsonb_build_array(v_ticket."status", v_status),
            'priority', pg_catalog.jsonb_build_array(v_ticket."priority", v_priority),
            'assigneeId', pg_catalog.jsonb_build_array(v_ticket."assignee_id", v_assignee)),
          p_ip);
  RETURN v_ticket."tenant_id";
END
$fn$;--> statement-breakpoint

-- Tickets with unread tenant activity (backoffice badge).
CREATE FUNCTION public."platform_support_unread_count"(p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN (SELECT pg_catalog.count(*)::integer FROM public."support_tickets" s WHERE s."admin_unread" AND s."status" <> 'resolved');
END
$fn$;--> statement-breakpoint

CREATE FUNCTION public."platform_support_canned_list"(p_actor uuid)
RETURNS TABLE (canned_id uuid, title text, body text, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY SELECT c."id", c."title", c."body", c."updated_at" FROM public."support_canned_responses" c ORDER BY c."title", c."id" LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Create (p_id NULL) or update a canned response. Audited.
CREATE FUNCTION public."platform_support_canned_upsert"(p_actor uuid, p_id uuid, p_title text, p_body text, p_ip inet)
RETURNS TABLE (canned_id uuid, title text, body text, updated_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_id uuid;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_id IS NULL THEN
    INSERT INTO public."support_canned_responses" ("title", "body", "updated_by")
    VALUES (p_title, p_body, p_actor) RETURNING "id" INTO v_id;
  ELSE
    UPDATE public."support_canned_responses" c
    SET "title" = p_title, "body" = p_body, "updated_by" = p_actor, "updated_at" = pg_catalog.now()
    WHERE c."id" = p_id RETURNING c."id" INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'platform: canned response not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, CASE WHEN p_id IS NULL THEN 'support.canned_create' ELSE 'support.canned_update' END, NULL,
          pg_catalog.jsonb_build_object('cannedId', v_id, 'title', p_title), p_ip);
  RETURN QUERY SELECT c."id", c."title", c."body", c."updated_at" FROM public."support_canned_responses" c WHERE c."id" = v_id;
END
$fn$;--> statement-breakpoint

CREATE FUNCTION public."platform_support_canned_delete"(p_actor uuid, p_id uuid, p_ip inet)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_title text;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  DELETE FROM public."support_canned_responses" c WHERE c."id" = p_id RETURNING c."title" INTO v_title;
  IF v_title IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'support.canned_delete', NULL, pg_catalog.jsonb_build_object('cannedId', p_id, 'title', v_title), p_ip);
  RETURN true;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."platform_support_ticket_list"(uuid, text, text, text, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_support_messages"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_support_mark_read"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_support_reply"(uuid, uuid, text, boolean, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_support_update"(uuid, uuid, text, text, text, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_support_unread_count"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_support_canned_list"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_support_canned_upsert"(uuid, uuid, text, text, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_support_canned_delete"(uuid, uuid, inet) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."platform_support_ticket_list"(uuid, text, text, text, uuid, text, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_support_messages"(uuid, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_support_mark_read"(uuid, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_support_reply"(uuid, uuid, text, boolean, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_support_update"(uuid, uuid, text, text, text, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_support_unread_count"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_support_canned_list"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_support_canned_upsert"(uuid, uuid, text, text, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_support_canned_delete"(uuid, uuid, inet) TO crmwsp_app;
  END IF;
END
$$;
