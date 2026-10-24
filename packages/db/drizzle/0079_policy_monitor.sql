-- Daily Meta/WhatsApp policy monitor (ADR 0021, T3). Platform tables (no privileges for crmwsp_app,
-- RLS enabled without policies, as 0052). The worker writes through policy_monitor_* (public policy
-- text only, no tenant data); admins read/review through platform_policy_* (admin re-check, audited).
-- A detected change is only a proposal: nothing here touches business_categories or tenants.

CREATE TABLE public."policy_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_key" text NOT NULL,
  "url" text NOT NULL,
  "content_hash" char(64) NOT NULL,
  "content" text NOT NULL,
  "etag" text,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "policy_snapshots_source_check" CHECK ("source_key" ~ '^[a-z0-9_]{2,64}$'),
  CONSTRAINT "policy_snapshots_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "policy_snapshots_content_check" CHECK (length("content") <= 600000)
);--> statement-breakpoint
CREATE INDEX "policy_snapshots_source_fetched_idx" ON public."policy_snapshots" ("source_key", "fetched_at" DESC);--> statement-breakpoint

CREATE TABLE public."policy_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_key" text NOT NULL,
  "url" text NOT NULL,
  "previous_snapshot_id" uuid REFERENCES public."policy_snapshots"("id") ON DELETE SET NULL,
  "snapshot_id" uuid NOT NULL REFERENCES public."policy_snapshots"("id") ON DELETE CASCADE,
  "diff_summary" text NOT NULL,
  "added_lines" integer NOT NULL DEFAULT 0,
  "removed_lines" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'pending',
  "reviewed_by" uuid REFERENCES public."users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamptz,
  "review_notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "policy_changes_status_check" CHECK ("status" IN ('pending', 'reviewed')),
  CONSTRAINT "policy_changes_diff_check" CHECK (length("diff_summary") <= 40000),
  CONSTRAINT "policy_changes_notes_check" CHECK ("review_notes" IS NULL OR length("review_notes") <= 2000)
);--> statement-breakpoint
CREATE INDEX "policy_changes_status_created_idx" ON public."policy_changes" ("status", "created_at" DESC);--> statement-breakpoint

ALTER TABLE public."policy_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."policy_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public."policy_snapshots" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public."policy_changes" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."policy_snapshots" FROM crmwsp_app;
    REVOKE ALL ON TABLE public."policy_changes" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Worker: latest snapshot of a source (to compare and to send If-None-Match).
CREATE FUNCTION public."policy_monitor_last"(p_source text)
RETURNS TABLE (content_hash text, content text, etag text, fetched_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT s."content_hash"::text, s."content", s."etag", s."fetched_at"
  FROM public."policy_snapshots" s WHERE s."source_key" = p_source
  ORDER BY s."fetched_at" DESC, s."id" LIMIT 1;
$fn$;--> statement-breakpoint

-- Worker: stores a snapshot when the hash changed (or the first one). Creates a pending
-- policy_changes row when there was a previous snapshot. Returns the change id (or NULL).
CREATE FUNCTION public."policy_monitor_record"(
  p_source text, p_url text, p_hash text, p_content text, p_etag text, p_diff text, p_added integer, p_removed integer
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_prev public."policy_snapshots"%ROWTYPE;
  v_snap uuid;
  v_change uuid;
BEGIN
  IF p_source IS NULL OR p_source !~ '^[a-z0-9_]{2,64}$' OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
     OR p_url IS NULL OR p_url !~ '^https://' OR pg_catalog.length(p_url) > 500
     OR p_content IS NULL OR pg_catalog.length(p_content) > 600000 OR pg_catalog.length(coalesce(p_diff, '')) > 40000 THEN
    RAISE EXCEPTION 'policy monitor: invalid argument' USING ERRCODE = '22023';
  END IF;
  -- One writer at a time per source (two workers on the same tick).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('policy_monitor:' || p_source, 0));
  SELECT * INTO v_prev FROM public."policy_snapshots" s WHERE s."source_key" = p_source ORDER BY s."fetched_at" DESC, s."id" LIMIT 1;
  IF FOUND AND v_prev."content_hash" = p_hash THEN
    RETURN NULL;
  END IF;
  INSERT INTO public."policy_snapshots" ("source_key", "url", "content_hash", "content", "etag")
  VALUES (p_source, p_url, p_hash, p_content, NULLIF(pg_catalog.left(coalesce(p_etag, ''), 200), ''))
  RETURNING "id" INTO v_snap;
  IF v_prev."id" IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public."policy_changes" ("source_key", "url", "previous_snapshot_id", "snapshot_id", "diff_summary", "added_lines", "removed_lines")
  VALUES (p_source, p_url, v_prev."id", v_snap, coalesce(p_diff, ''), coalesce(p_added, 0), coalesce(p_removed, 0))
  RETURNING "id" INTO v_change;
  RETURN v_change;
END
$fn$;--> statement-breakpoint

-- Backoffice: detected changes (default pending), newest first.
CREATE FUNCTION public."platform_policy_change_list"(p_actor uuid, p_status text)
RETURNS TABLE (
  id uuid, source_key text, url text, diff_summary text, added_lines integer, removed_lines integer, status text,
  reviewed_by_email text, reviewed_at timestamptz, review_notes text, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'reviewed') THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT c."id", c."source_key", c."url", c."diff_summary", c."added_lines", c."removed_lines", c."status",
           u."email", c."reviewed_at", c."review_notes", c."created_at"
    FROM public."policy_changes" c LEFT JOIN public."users" u ON u."id" = c."reviewed_by"
    WHERE p_status IS NULL OR c."status" = p_status
    ORDER BY c."created_at" DESC, c."id"
    LIMIT 200;
END
$fn$;--> statement-breakpoint

-- Backoffice: marks a change reviewed (optional notes). Audited. Rule updates are a separate,
-- explicit action (platform_business_category_upsert): never applied from here.
CREATE FUNCTION public."platform_policy_change_review"(p_actor uuid, p_change uuid, p_notes text, p_ip inet)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_notes text := NULLIF(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_source text;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF v_notes IS NOT NULL AND pg_catalog.length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  UPDATE public."policy_changes" SET "status" = 'reviewed', "reviewed_by" = p_actor, "reviewed_at" = pg_catalog.now(), "review_notes" = v_notes
  WHERE "id" = p_change AND "status" = 'pending'
  RETURNING "source_key" INTO v_source;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public."policy_changes" c WHERE c."id" = p_change) THEN
      RAISE EXCEPTION 'platform: already reviewed' USING ERRCODE = '55000';
    END IF;
    RAISE EXCEPTION 'platform: change not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'policy_change.reviewed', NULL, pg_catalog.jsonb_build_object('changeId', p_change, 'source', v_source, 'notes', v_notes), p_ip);
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."policy_monitor_last"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."policy_monitor_record"(text, text, text, text, text, text, integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_policy_change_list"(uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_policy_change_review"(uuid, uuid, text, inet) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."policy_monitor_last"(text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."policy_monitor_record"(text, text, text, text, text, text, integer, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_policy_change_list"(uuid, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_policy_change_review"(uuid, uuid, text, inet) TO crmwsp_app;
  END IF;
END
$$;
