-- Platform backoffice sections (ADR 0011, T31): users, BSP channels, plans, usage and the audit
-- log. Same conventions as 0052: SECURITY DEFINER owned by the migrator, fixed search_path with
-- pg_temp last, schema-qualified objects, EXECUTE only for crmwsp_app, errors without data.
-- Every function re-checks platform_admins (42501) and returns whitelisted/aggregated columns:
-- never conversations, message bodies, contacts, secrets, tokens or full phone numbers.

CREATE INDEX IF NOT EXISTS "platform_audit_events_created_idx" ON public."platform_audit_events" USING btree ("created_at");--> statement-breakpoint

-- Users across tenants. last_login_at = newest session created; tenants = [{tenantId, name, role}].
CREATE FUNCTION public."platform_user_list"(p_actor uuid, p_search text, p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  user_id uuid, email text, name text, created_at timestamptz, last_login_at timestamptz,
  active_sessions integer, is_platform_admin boolean, tenants jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_search text := NULLIF(pg_catalog.btrim(coalesce(p_search, '')), '');
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF v_search IS NOT NULL AND pg_catalog.length(v_search) > 200 THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT u."id", u."email", u."name", u."created_at",
           (SELECT pg_catalog.max(s."created_at") FROM public."sessions" s WHERE s."user_id" = u."id"),
           (SELECT pg_catalog.count(*)::integer FROM public."sessions" s
            WHERE s."user_id" = u."id" AND s."revoked_at" IS NULL AND s."expires_at" > pg_catalog.now()),
           EXISTS (SELECT 1 FROM public."platform_admins" a WHERE a."user_id" = u."id"),
           coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tenantId', t."id", 'name', t."name", 'role', m."role")
                                                 ORDER BY m."created_at", t."id")
                     FROM public."memberships" m JOIN public."tenants" t ON t."id" = m."tenant_id"
                     WHERE m."user_id" = u."id"), '[]'::jsonb)
    FROM public."users" u
    WHERE (p_user_id IS NULL OR u."id" = p_user_id)
      AND (v_search IS NULL OR u."email" ILIKE '%' || v_search || '%' OR u."name" ILIKE '%' || v_search || '%')
    ORDER BY u."created_at" DESC, u."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Revokes every live session of a user (forces a new login). Audited. Returns the count revoked.
CREATE FUNCTION public."platform_revoke_user_sessions"(p_actor uuid, p_user_id uuid, p_ip inet)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF NOT EXISTS (SELECT 1 FROM public."users" u WHERE u."id" = p_user_id) THEN
    RAISE EXCEPTION 'platform: user not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public."sessions" SET "revoked_at" = pg_catalog.now()
  WHERE "user_id" = p_user_id AND "revoked_at" IS NULL AND "expires_at" > pg_catalog.now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'user.sessions_revoked', NULL, pg_catalog.jsonb_build_object('userId', p_user_id, 'revoked', v_count), p_ip);
  RETURN v_count;
END
$fn$;--> statement-breakpoint

-- BSP channel connections across tenants. Only the last 4 digits of the number; never the
-- external app id, credentials or webhook token. failed_7d = failed outbound messages, 7 days.
CREATE FUNCTION public."platform_channel_list"(p_actor uuid, p_status text)
RETURNS TABLE (
  channel_id uuid, tenant_id uuid, tenant_name text, provider text, phone_last4 text, status text,
  created_at timestamptz, last_inbound_at timestamptz, last_outbound_at timestamptz, failed_7d integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'active', 'disabled') THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT c."id", c."tenant_id", t."name", c."provider"::text, pg_catalog.right(c."phone_e164", 4), c."status"::text,
           c."created_at",
           (SELECT pg_catalog.max(m."created_at") FROM public."conversations" v JOIN public."messages" m
              ON m."tenant_id" = v."tenant_id" AND m."conversation_id" = v."id"
            WHERE v."tenant_id" = c."tenant_id" AND v."channel_connection_id" = c."id" AND m."direction" = 'inbound'),
           (SELECT pg_catalog.max(m."created_at") FROM public."conversations" v JOIN public."messages" m
              ON m."tenant_id" = v."tenant_id" AND m."conversation_id" = v."id"
            WHERE v."tenant_id" = c."tenant_id" AND v."channel_connection_id" = c."id" AND m."direction" = 'outbound'),
           (SELECT pg_catalog.count(*)::integer FROM public."conversations" v JOIN public."messages" m
              ON m."tenant_id" = v."tenant_id" AND m."conversation_id" = v."id"
            WHERE v."tenant_id" = c."tenant_id" AND v."channel_connection_id" = c."id" AND m."status" = 'failed'
              AND m."created_at" > pg_catalog.now() - interval '7 days')
    FROM public."channel_connections" c
    JOIN public."tenants" t ON t."id" = c."tenant_id"
    WHERE p_status IS NULL OR c."status"::text = p_status
    ORDER BY c."created_at" DESC, c."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Tenants per plan and status (plan catalog itself lives in @crmwsp/billing).
CREATE FUNCTION public."platform_plan_counts"(p_actor uuid)
RETURNS TABLE (plan text, status text, tenant_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT coalesce(tp."plan", 'start'), t."status", pg_catalog.count(*)::integer
    FROM public."tenants" t LEFT JOIN public."tenant_plans" tp ON tp."tenant_id" = t."id"
    GROUP BY 1, 2
    ORDER BY 1, 2;
END
$fn$;--> statement-breakpoint

-- Tenants with per-tenant limit overrides.
CREATE FUNCTION public."platform_limit_overrides"(p_actor uuid)
RETURNS TABLE (tenant_id uuid, name text, slug text, status text, plan text, limits_override jsonb, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT t."id", t."name", t."slug", t."status", tp."plan", tp."limits_override", tp."updated_at"
    FROM public."tenant_plans" tp JOIN public."tenants" t ON t."id" = tp."tenant_id"
    WHERE tp."limits_override" IS NOT NULL AND tp."limits_override" <> '{}'::jsonb
    ORDER BY tp."updated_at" DESC, t."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Usage per tenant in a calendar month (YYYY-MM). Counters use the tenant period key; the ledger
-- is summed over the UTC month. ai_cost_micro = USD micro-cents (1e-8 USD) of the AI kinds.
CREATE FUNCTION public."platform_usage"(p_actor uuid, p_month text)
RETURNS TABLE (
  tenant_id uuid, name text, slug text, plan text, ai_messages bigint, broadcast_sends bigint,
  tts_characters bigint, ai_cost_micro bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_from timestamptz;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  v_from := (p_month || '-01')::date::timestamp AT TIME ZONE 'UTC';
  RETURN QUERY
    WITH ledger AS (
      SELECT l."tenant_id",
             coalesce(pg_catalog.sum(l."quantity") FILTER (WHERE l."kind" = 'tts_characters'), 0) AS tts,
             coalesce(pg_catalog.sum(l."cost_minor") FILTER (
               WHERE l."currency" = 'USD' AND l."kind" IN ('llm_tokens', 'embedding_tokens', 'transcription_seconds', 'simulation')), 0) AS cost
      FROM public."usage_ledger" l
      WHERE l."occurred_at" >= v_from AND l."occurred_at" < v_from + interval '1 month'
      GROUP BY l."tenant_id"
    ),
    counters AS (
      SELECT u."tenant_id",
             coalesce(pg_catalog.sum(u."used") FILTER (WHERE u."limit_key" = 'ai_messages'), 0) AS ai,
             coalesce(pg_catalog.sum(u."used") FILTER (WHERE u."limit_key" = 'broadcast_sends'), 0) AS bc
      FROM public."usage_counters" u WHERE u."period" = p_month
      GROUP BY u."tenant_id"
    )
    SELECT t."id", t."name", t."slug", coalesce(tp."plan", 'start'),
           coalesce(c.ai, 0)::bigint, coalesce(c.bc, 0)::bigint,
           pg_catalog.round(coalesce(l.tts, 0))::bigint, coalesce(l.cost, 0)::bigint
    FROM public."tenants" t
    LEFT JOIN public."tenant_plans" tp ON tp."tenant_id" = t."id"
    LEFT JOIN ledger l ON l."tenant_id" = t."id"
    LEFT JOIN counters c ON c."tenant_id" = t."id"
    WHERE l."tenant_id" IS NOT NULL OR c."tenant_id" IS NOT NULL
    ORDER BY 8 DESC, 5 DESC, t."id"
    LIMIT 1000;
END
$fn$;--> statement-breakpoint

-- Audit log search with filters and offset pagination (total_count = matches before paging).
CREATE FUNCTION public."platform_audit_search"(
  p_actor uuid, p_actor_email text, p_action text, p_tenant_id uuid, p_from timestamptz, p_to timestamptz,
  p_limit integer, p_offset integer
)
RETURNS TABLE (
  event_id uuid, actor_email text, action text, tenant_id uuid, tenant_name text, diff jsonb,
  created_at timestamptz, total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_email text := NULLIF(pg_catalog.btrim(coalesce(p_actor_email, '')), '');
  v_action text := NULLIF(pg_catalog.btrim(coalesce(p_action, '')), '');
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF pg_catalog.length(coalesce(v_email, '')) > 200 OR pg_catalog.length(coalesce(v_action, '')) > 100
     OR coalesce(p_offset, 0) < 0 OR coalesce(p_offset, 0) > 100000 THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT e."id", u."email", e."action", e."tenant_id", t."name", e."diff", e."created_at",
           pg_catalog.count(*) OVER ()
    FROM public."platform_audit_events" e
    LEFT JOIN public."users" u ON u."id" = e."actor_id"
    LEFT JOIN public."tenants" t ON t."id" = e."tenant_id"
    WHERE (v_email IS NULL OR u."email" ILIKE '%' || v_email || '%')
      AND (v_action IS NULL OR e."action" ILIKE v_action || '%')
      AND (p_tenant_id IS NULL OR e."tenant_id" = p_tenant_id)
      AND (p_from IS NULL OR e."created_at" >= p_from)
      AND (p_to IS NULL OR e."created_at" < p_to)
    ORDER BY e."created_at" DESC, e."id"
    LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200)
    OFFSET coalesce(p_offset, 0);
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."platform_user_list"(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_revoke_user_sessions"(uuid, uuid, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_channel_list"(uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_plan_counts"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_limit_overrides"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_usage"(uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_audit_search"(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."platform_user_list"(uuid, text, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_revoke_user_sessions"(uuid, uuid, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_channel_list"(uuid, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_plan_counts"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_limit_overrides"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_usage"(uuid, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_audit_search"(uuid, text, text, uuid, timestamptz, timestamptz, integer, integer) TO crmwsp_app;
  END IF;
END
$$;
