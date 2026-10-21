-- Platform backoffice (ADR 0011). The platform tables are NOT reachable by the app role: no
-- privileges at all, RLS enabled without policies (defence in depth). Cross-tenant reads and the
-- admin actions go ONLY through the SECURITY DEFINER functions below (same conventions as
-- 0006/0026/0050: owned by the migrator, fixed search_path with pg_temp last, schema-qualified
-- objects, EXECUTE only for crmwsp_app, errors without data, never set_config('app.*')).
-- Every function re-checks that the actor is in platform_admins (42501 otherwise) and returns
-- only whitelisted/aggregated columns: never conversations, messages, contacts or secrets.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public."platform_admins" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public."platform_settings" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public."platform_audit_events" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public."subscription_payments" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."platform_admins" FROM crmwsp_app;
    REVOKE ALL ON TABLE public."platform_settings" FROM crmwsp_app;
    REVOKE ALL ON TABLE public."platform_audit_events" FROM crmwsp_app;
    REVOKE ALL ON TABLE public."subscription_payments" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO public."platform_settings" ("id", "require_approval") VALUES (1, false) ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Append-only audit: no UPDATE/DELETE/TRUNCATE, not even by the owner through SQL by mistake.
CREATE FUNCTION public."platform_audit_events_append_only"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'platform_audit_events is append-only' USING ERRCODE = '42501';
END
$fn$;--> statement-breakpoint
CREATE TRIGGER "platform_audit_events_no_update" BEFORE UPDATE OR DELETE ON public."platform_audit_events"
  FOR EACH ROW EXECUTE FUNCTION public."platform_audit_events_append_only"();--> statement-breakpoint
CREATE TRIGGER "platform_audit_events_no_truncate" BEFORE TRUNCATE ON public."platform_audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION public."platform_audit_events_append_only"();--> statement-breakpoint

-- Is this user a platform admin? (The API re-checks it on every /platform request.)
CREATE FUNCTION public."platform_is_admin"(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public."platform_admins" a WHERE a."user_id" = p_user_id);
$fn$;--> statement-breakpoint

-- Internal guard (not granted): raises 42501 unless the actor is a platform admin.
CREATE FUNCTION public."platform_assert_admin_internal"(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public."platform_admins" a WHERE a."user_id" = p_actor) THEN
    RAISE EXCEPTION 'platform: not allowed' USING ERRCODE = '42501';
  END IF;
END
$fn$;--> statement-breakpoint

-- Tenant overview rows (whitelisted columns only). Filters are optional; at most 500 rows.
-- paid_until = latest period_end of the recorded subscription payments. overdue = an active
-- tenant whose paid period ended, or that never paid and is older than 14 days (grace).
CREATE FUNCTION public."platform_tenant_list"(p_actor uuid, p_search text, p_status text, p_plan text, p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
  tenant_id uuid, name text, slug text, status text, status_reason text, plan text,
  limits_override jsonb, created_at timestamptz, owner_email text, owner_name text,
  member_count integer, seats integer, ai_messages bigint, broadcast_sends bigint,
  channel_count integer, last_activity_at timestamptz, paid_until date, overdue boolean, period text
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
    WITH base AS (
      SELECT t."id", t."name", t."slug", t."status", t."status_reason", t."created_at",
             coalesce(tp."plan", 'start') AS plan, tp."limits_override",
             pg_catalog.to_char(pg_catalog.now() AT TIME ZONE t."timezone", 'YYYY-MM') AS period
      FROM public."tenants" t
      LEFT JOIN public."tenant_plans" tp ON tp."tenant_id" = t."id"
      WHERE (p_tenant_id IS NULL OR t."id" = p_tenant_id)
        AND (p_status IS NULL OR t."status" = p_status)
        AND (p_plan IS NULL OR coalesce(tp."plan", 'start') = p_plan)
    )
    SELECT b."id", b."name", b."slug", b."status", b."status_reason", b.plan, b."limits_override", b."created_at",
           o.email, o.name,
           (SELECT pg_catalog.count(*)::integer FROM public."memberships" m WHERE m."tenant_id" = b."id"),
           (SELECT pg_catalog.count(*)::integer FROM public."memberships" m WHERE m."tenant_id" = b."id")
             + (SELECT pg_catalog.count(*)::integer FROM public."team_invitations" i
                WHERE i."tenant_id" = b."id" AND i."accepted_at" IS NULL AND i."revoked_at" IS NULL AND i."expires_at" > pg_catalog.now()),
           coalesce((SELECT u."used" FROM public."usage_counters" u WHERE u."tenant_id" = b."id" AND u."period" = b.period AND u."limit_key" = 'ai_messages'), 0)::bigint,
           coalesce((SELECT u."used" FROM public."usage_counters" u WHERE u."tenant_id" = b."id" AND u."period" = b.period AND u."limit_key" = 'broadcast_sends'), 0)::bigint,
           (SELECT pg_catalog.count(*)::integer FROM public."channel_connections" c WHERE c."tenant_id" = b."id" AND c."status" <> 'disabled'),
           (SELECT pg_catalog.max(x."created_at") FROM public."messages" x WHERE x."tenant_id" = b."id"),
           p.paid_until,
           (b."status" = 'active' AND (p.paid_until < CURRENT_DATE
              OR (p.paid_until IS NULL AND b."created_at" < pg_catalog.now() - interval '14 days'))),
           b.period
    FROM base b
    LEFT JOIN LATERAL (
      SELECT u."email", u."name" FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
      WHERE m."tenant_id" = b."id" AND m."role" = 'owner' ORDER BY m."created_at", m."user_id" LIMIT 1
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT pg_catalog.max(s."period_end") AS paid_until FROM public."subscription_payments" s WHERE s."tenant_id" = b."id"
    ) p ON true
    WHERE v_search IS NULL
       OR b."name" ILIKE '%' || v_search || '%'
       OR b."slug" ILIKE '%' || v_search || '%'
       OR o.email ILIKE '%' || v_search || '%'
    ORDER BY b."created_at" DESC, b."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Members of one tenant: name, email and role only.
CREATE FUNCTION public."platform_tenant_members"(p_actor uuid, p_tenant_id uuid)
RETURNS TABLE (name text, email text, role public."membership_role")
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT u."name", u."email", m."role"
    FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
    WHERE m."tenant_id" = p_tenant_id
    ORDER BY m."created_at", m."user_id";
END
$fn$;--> statement-breakpoint

-- Channels of one tenant: status only (never tokens, numbers or credentials).
CREATE FUNCTION public."platform_tenant_channels"(p_actor uuid, p_tenant_id uuid)
RETURNS TABLE (channel_id uuid, status text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT c."id", c."status"::text, c."created_at"
    FROM public."channel_connections" c
    WHERE c."tenant_id" = p_tenant_id
    ORDER BY c."created_at", c."id";
END
$fn$;--> statement-breakpoint

-- Status transitions (mirror of @crmwsp/domain platform transitions):
--   approve:    pending_approval -> active
--   reject:     pending_approval -> rejected   (reason required)
--   suspend:    active -> suspended            (reason required)
--   reactivate: suspended | rejected -> active
-- 22023 = invalid action/reason, P0002 = tenant not found, 55000 = transition not allowed.
CREATE FUNCTION public."platform_set_tenant_status"(p_actor uuid, p_tenant_id uuid, p_action text, p_reason text, p_ip inet)
RETURNS TABLE (tenant_id uuid, name text, status text, previous_status text, owner_email text, owner_name text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_t public."tenants"%ROWTYPE;
  v_to text;
  v_reason text := NULLIF(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_email text;
  v_name text;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject', 'suspend', 'reactivate')
     OR (v_reason IS NOT NULL AND pg_catalog.length(v_reason) > 500)
     OR (p_action IN ('reject', 'suspend') AND v_reason IS NULL) THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT t.* INTO v_t FROM public."tenants" t WHERE t."id" = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform: tenant not found' USING ERRCODE = 'P0002';
  END IF;
  v_to := CASE
    WHEN p_action = 'approve' AND v_t."status" = 'pending_approval' THEN 'active'
    WHEN p_action = 'reject' AND v_t."status" = 'pending_approval' THEN 'rejected'
    WHEN p_action = 'suspend' AND v_t."status" = 'active' THEN 'suspended'
    WHEN p_action = 'reactivate' AND v_t."status" IN ('suspended', 'rejected') THEN 'active'
  END;
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'platform: transition not allowed' USING ERRCODE = '55000';
  END IF;
  UPDATE public."tenants" SET "status" = v_to,
    "status_reason" = CASE WHEN v_to = 'active' THEN NULL ELSE v_reason END,
    "updated_at" = pg_catalog.now()
  WHERE "id" = v_t."id";
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'tenant.' || p_action, v_t."id",
          pg_catalog.jsonb_build_object('from', v_t."status", 'to', v_to, 'reason', v_reason), p_ip);
  SELECT u."email", u."name" INTO v_email, v_name
  FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
  WHERE m."tenant_id" = v_t."id" AND m."role" = 'owner' ORDER BY m."created_at", m."user_id" LIMIT 1;
  RETURN QUERY SELECT v_t."id", v_t."name", v_to, v_t."status", v_email, v_name;
END
$fn$;--> statement-breakpoint

-- Plan change (+ optional limit overrides), effective immediately. Audited with before/after.
CREATE FUNCTION public."platform_set_tenant_plan"(p_actor uuid, p_tenant_id uuid, p_plan text, p_limits jsonb, p_ip inet)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_old_plan text;
  v_old_limits jsonb;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_plan IS NULL OR p_plan NOT IN ('start', 'pro')
     OR (p_limits IS NOT NULL AND (pg_catalog.jsonb_typeof(p_limits) <> 'object' OR pg_catalog.octet_length(p_limits::text) > 2000)) THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."tenants" t WHERE t."id" = p_tenant_id) THEN
    RAISE EXCEPTION 'platform: tenant not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT tp."plan", tp."limits_override" INTO v_old_plan, v_old_limits
  FROM public."tenant_plans" tp WHERE tp."tenant_id" = p_tenant_id FOR UPDATE;
  INSERT INTO public."tenant_plans" ("tenant_id", "plan", "limits_override")
  VALUES (p_tenant_id, p_plan, p_limits)
  ON CONFLICT ("tenant_id") DO UPDATE SET "plan" = EXCLUDED."plan", "limits_override" = EXCLUDED."limits_override", "updated_at" = pg_catalog.now();
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'tenant.plan_changed', p_tenant_id,
          pg_catalog.jsonb_build_object('from', pg_catalog.jsonb_build_object('plan', coalesce(v_old_plan, 'start'), 'limits', v_old_limits),
                                        'to', pg_catalog.jsonb_build_object('plan', p_plan, 'limits', p_limits)), p_ip);
END
$fn$;--> statement-breakpoint

-- Records a manual subscription payment (SaaS revenue). 22023 invalid, P0002 unknown tenant.
CREATE FUNCTION public."platform_record_payment"(
  p_actor uuid, p_tenant_id uuid, p_amount_minor bigint, p_currency text, p_period_start date, p_period_end date,
  p_method text, p_reference text, p_notes text, p_ip inet
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
     OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start
     OR p_method IS NULL OR p_method NOT IN ('transfer', 'cash', 'card_manual', 'mercadopago', 'stripe')
     OR pg_catalog.length(coalesce(p_reference, '')) > 200 OR pg_catalog.length(coalesce(p_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."tenants" t WHERE t."id" = p_tenant_id) THEN
    RAISE EXCEPTION 'platform: tenant not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public."subscription_payments"
    ("tenant_id", "amount_minor", "currency", "period_start", "period_end", "method", "reference", "recorded_by", "notes")
  VALUES (p_tenant_id, p_amount_minor, p_currency, p_period_start, p_period_end, p_method,
          NULLIF(pg_catalog.btrim(coalesce(p_reference, '')), ''), p_actor, NULLIF(pg_catalog.btrim(coalesce(p_notes, '')), ''))
  RETURNING "id" INTO v_id;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'subscription_payment.recorded', p_tenant_id,
          pg_catalog.jsonb_build_object('paymentId', v_id, 'amountMinor', p_amount_minor, 'currency', p_currency,
                                        'periodStart', p_period_start, 'periodEnd', p_period_end, 'method', p_method), p_ip);
  RETURN v_id;
END
$fn$;--> statement-breakpoint

-- Payment list (optionally for one tenant and/or a created_at range), newest first, max 500.
CREATE FUNCTION public."platform_list_payments"(p_actor uuid, p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  payment_id uuid, tenant_id uuid, tenant_name text, amount_minor bigint, currency text, period_start date,
  period_end date, method text, reference text, notes text, recorded_by_email text, created_at timestamptz
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
    SELECT s."id", s."tenant_id", t."name", s."amount_minor", s."currency"::text, s."period_start", s."period_end",
           s."method", s."reference", s."notes", u."email", s."created_at"
    FROM public."subscription_payments" s
    JOIN public."tenants" t ON t."id" = s."tenant_id"
    LEFT JOIN public."users" u ON u."id" = s."recorded_by"
    WHERE (p_tenant_id IS NULL OR s."tenant_id" = p_tenant_id)
      AND (p_from IS NULL OR s."created_at" >= p_from)
      AND (p_to IS NULL OR s."created_at" < p_to)
    ORDER BY s."created_at" DESC, s."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Totals per calendar month (UTC, by created_at) and currency for the last p_months months.
CREATE FUNCTION public."platform_payment_totals"(p_actor uuid, p_months integer)
RETURNS TABLE (month text, currency text, total_minor bigint, payment_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_months IS NULL OR p_months NOT BETWEEN 1 AND 36 THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT pg_catalog.to_char(s."created_at" AT TIME ZONE 'UTC', 'YYYY-MM'), s."currency"::text,
           pg_catalog.sum(s."amount_minor")::bigint, pg_catalog.count(*)::integer
    FROM public."subscription_payments" s
    WHERE s."created_at" >= pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                           - pg_catalog.make_interval(months => p_months - 1)
    GROUP BY 1, 2
    ORDER BY 1 DESC, 2;
END
$fn$;--> statement-breakpoint

-- Dashboard counters: tenants by status, active tenants by plan, overdue count.
CREATE FUNCTION public."platform_dashboard"(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_status jsonb;
  v_plans jsonb;
  v_overdue integer;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  SELECT coalesce(pg_catalog.jsonb_object_agg(x.status, x.n), '{}'::jsonb) INTO v_status
  FROM (SELECT t."status", pg_catalog.count(*)::integer AS n FROM public."tenants" t GROUP BY 1) x;
  SELECT coalesce(pg_catalog.jsonb_object_agg(x.plan, x.n), '{}'::jsonb) INTO v_plans
  FROM (SELECT coalesce(tp."plan", 'start') AS plan, pg_catalog.count(*)::integer AS n
        FROM public."tenants" t LEFT JOIN public."tenant_plans" tp ON tp."tenant_id" = t."id"
        WHERE t."status" = 'active' GROUP BY 1) x;
  SELECT pg_catalog.count(*)::integer INTO v_overdue
  FROM public."tenants" t
  LEFT JOIN LATERAL (SELECT pg_catalog.max(s."period_end") AS paid_until FROM public."subscription_payments" s WHERE s."tenant_id" = t."id") p ON true
  WHERE t."status" = 'active' AND (p.paid_until < CURRENT_DATE
    OR (p.paid_until IS NULL AND t."created_at" < pg_catalog.now() - interval '14 days'));
  RETURN pg_catalog.jsonb_build_object('byStatus', v_status, 'activeByPlan', v_plans, 'overdue', v_overdue);
END
$fn$;--> statement-breakpoint

-- Platform audit trail (optionally of one tenant), newest first.
CREATE FUNCTION public."platform_audit_list"(p_actor uuid, p_tenant_id uuid, p_limit integer)
RETURNS TABLE (event_id uuid, actor_email text, action text, tenant_id uuid, diff jsonb, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT e."id", u."email", e."action", e."tenant_id", e."diff", e."created_at"
    FROM public."platform_audit_events" e
    LEFT JOIN public."users" u ON u."id" = e."actor_id"
    WHERE p_tenant_id IS NULL OR e."tenant_id" = p_tenant_id
    ORDER BY e."created_at" DESC, e."id"
    LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END
$fn$;--> statement-breakpoint

CREATE FUNCTION public."platform_get_settings"(p_actor uuid)
RETURNS TABLE (require_approval boolean, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY SELECT s."require_approval", s."updated_at" FROM public."platform_settings" s WHERE s."id" = 1;
END
$fn$;--> statement-breakpoint

CREATE FUNCTION public."platform_set_require_approval"(p_actor uuid, p_value boolean, p_ip inet)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_old boolean;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT s."require_approval" INTO v_old FROM public."platform_settings" s WHERE s."id" = 1 FOR UPDATE;
  INSERT INTO public."platform_settings" ("id", "require_approval", "updated_by") VALUES (1, p_value, p_actor)
  ON CONFLICT ("id") DO UPDATE SET "require_approval" = EXCLUDED."require_approval", "updated_by" = p_actor, "updated_at" = pg_catalog.now();
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'settings.require_approval', NULL,
          pg_catalog.jsonb_build_object('from', coalesce(v_old, false), 'to', p_value), p_ip);
END
$fn$;--> statement-breakpoint

-- list_user_tenants now also returns the tenant status (the panel shows the review screen and
-- the tenant guard blocks non-active tenants). The return type changes, so drop and recreate.
DROP FUNCTION public."list_user_tenants"(uuid);--> statement-breakpoint
CREATE FUNCTION public."list_user_tenants"(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, slug text, name text, role public."membership_role", status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT t."id", t."slug", t."name", m."role", t."status"
  FROM public."memberships" m
  JOIN public."tenants" t ON t."id" = m."tenant_id"
  WHERE m."user_id" = p_user_id
  ORDER BY t."created_at", t."id";
$fn$;--> statement-breakpoint

-- signup_tenant: same signature and behaviour as 0015, but the new tenant starts as
-- `pending_approval` when the platform setting require_approval is on (default off).
CREATE OR REPLACE FUNCTION public."signup_tenant"(
  p_email text,
  p_name text,
  p_password_hash text,
  p_tenant_name text,
  p_tenant_slug text
)
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_tenant uuid;
  v_status text := 'active';
BEGIN
  IF p_email IS NULL OR p_password_hash IS NULL OR p_tenant_name IS NULL OR p_tenant_slug IS NULL THEN
    RAISE EXCEPTION 'signup_tenant: arguments must not be null' USING ERRCODE = '22004';
  END IF;
  IF pg_catalog.length(p_email) NOT BETWEEN 3 AND 320
     OR pg_catalog.length(p_password_hash) NOT BETWEEN 1 AND 512
     OR pg_catalog.length(p_tenant_name) NOT BETWEEN 1 AND 200
     OR pg_catalog.length(coalesce(p_name, '')) > 200
     OR p_tenant_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$' THEN
    RAISE EXCEPTION 'signup_tenant: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public."platform_settings" s WHERE s."id" = 1 AND s."require_approval") THEN
    v_status := 'pending_approval';
  END IF;
  BEGIN
    INSERT INTO public."users" ("email", "name", "auth_provider")
    VALUES (pg_catalog.lower(p_email), p_name, 'password')
    RETURNING "id" INTO v_user;
    INSERT INTO public."tenants" ("slug", "name", "status")
    VALUES (p_tenant_slug, p_tenant_name, v_status)
    RETURNING "id" INTO v_tenant;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'signup_tenant: signup rejected' USING ERRCODE = '23505';
  END;
  INSERT INTO public."user_credentials" ("user_id", "password_hash") VALUES (v_user, p_password_hash);
  INSERT INTO public."memberships" ("tenant_id", "user_id", "role") VALUES (v_tenant, v_user, 'owner');
  PERFORM public."seed_default_pipeline_internal"(v_tenant);
  RETURN QUERY SELECT v_user, v_tenant;
END;
$fn$;--> statement-breakpoint

-- ingest_inbound_event: same as 0005, but only for ACTIVE tenants (pending, rejected or
-- suspended tenants receive nothing: the webhook is acknowledged and dropped).
CREATE OR REPLACE FUNCTION public."ingest_inbound_event"(
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
  JOIN public."tenants" t ON t."id" = c."tenant_id"
  WHERE c."webhook_token" = p_webhook_token
    AND c."provider" = p_provider
    AND c."status" <> 'disabled'
    AND t."status" = 'active';
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

REVOKE ALL ON FUNCTION public."platform_audit_events_append_only"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_is_admin"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_assert_admin_internal"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_tenant_list"(uuid, text, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_tenant_members"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_tenant_channels"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_set_tenant_status"(uuid, uuid, text, text, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_set_tenant_plan"(uuid, uuid, text, jsonb, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_record_payment"(uuid, uuid, bigint, text, date, date, text, text, text, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_list_payments"(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_payment_totals"(uuid, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_dashboard"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_audit_list"(uuid, uuid, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_get_settings"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_set_require_approval"(uuid, boolean, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."list_user_tenants"(uuid) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."platform_is_admin"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_tenant_list"(uuid, text, text, text, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_tenant_members"(uuid, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_tenant_channels"(uuid, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_set_tenant_status"(uuid, uuid, text, text, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_set_tenant_plan"(uuid, uuid, text, jsonb, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_record_payment"(uuid, uuid, bigint, text, date, date, text, text, text, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_list_payments"(uuid, uuid, timestamptz, timestamptz) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_payment_totals"(uuid, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_dashboard"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_audit_list"(uuid, uuid, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_get_settings"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_set_require_approval"(uuid, boolean, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."list_user_tenants"(uuid) TO crmwsp_app;
  END IF;
END
$$;
