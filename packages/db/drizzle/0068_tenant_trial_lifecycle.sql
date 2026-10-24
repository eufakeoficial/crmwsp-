-- Free trial lifecycle (ADR 0015, T6): new tenants start in SETUP for 7 days; the first active
-- channel starts a 7-day TRIAL. Stored on tenant_plans (read-only for the app role, 0024).
-- Tenants that exist before this migration keep setup_ends_at NULL = grandfathered.
ALTER TABLE public."tenant_plans" ADD COLUMN "setup_ends_at" timestamptz;--> statement-breakpoint
ALTER TABLE public."tenant_plans" ADD COLUMN "trial_started_at" timestamptz;--> statement-breakpoint
ALTER TABLE public."tenant_plans" ADD COLUMN "trial_ends_at" timestamptz;--> statement-breakpoint
ALTER TABLE public."tenant_plans" ADD COLUMN "setup_reminder_sent_at" timestamptz;--> statement-breakpoint
ALTER TABLE public."tenant_plans" ADD CONSTRAINT "tenant_plans_trial_check"
  CHECK (("trial_started_at" IS NULL) = ("trial_ends_at" IS NULL));--> statement-breakpoint

-- Every tenant created from now on gets its lifecycle row (whatever function created it).
CREATE FUNCTION public."tenant_lifecycle_init_trg"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public."tenant_plans" ("tenant_id", "setup_ends_at")
  VALUES (NEW."id", pg_catalog.now() + interval '7 days')
  ON CONFLICT ("tenant_id") DO UPDATE SET "setup_ends_at" = coalesce(public."tenant_plans"."setup_ends_at", EXCLUDED."setup_ends_at");
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER "tenants_lifecycle_init" AFTER INSERT ON public."tenants"
  FOR EACH ROW EXECUTE FUNCTION public."tenant_lifecycle_init_trg"();--> statement-breakpoint

-- Starts the trial of the CURRENT tenant (app.tenant_id) when it is in setup and has an active
-- channel. Idempotent: false when not eligible (grandfathered, already started, setup expired).
CREATE FUNCTION public."tenant_trial_start"()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_n integer;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant_trial_start: no tenant' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."channel_connections" c WHERE c."tenant_id" = v_tenant AND c."status" = 'active') THEN
    RETURN false;
  END IF;
  UPDATE public."tenant_plans" tp
  SET "trial_started_at" = pg_catalog.now(), "trial_ends_at" = pg_catalog.now() + interval '7 days', "updated_at" = pg_catalog.now()
  WHERE tp."tenant_id" = v_tenant AND tp."setup_ends_at" IS NOT NULL AND tp."trial_started_at" IS NULL
    AND pg_catalog.now() < tp."setup_ends_at";
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END
$fn$;--> statement-breakpoint

-- Platform admin: extend setup or trial by N days (1..90), from max(current end, now). Audited.
CREATE FUNCTION public."platform_extend_lifecycle"(p_actor uuid, p_tenant_id uuid, p_kind text, p_days integer, p_ip inet)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  tp public."tenant_plans"%ROWTYPE;
  v_end timestamptz;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_kind IS NULL OR p_kind NOT IN ('setup', 'trial') OR p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tp FROM public."tenant_plans" t WHERE t."tenant_id" = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR tp."setup_ends_at" IS NULL THEN
    RAISE EXCEPTION 'platform: tenant has no trial lifecycle' USING ERRCODE = 'P0002';
  END IF;
  IF p_kind = 'setup' THEN
    v_end := GREATEST(tp."setup_ends_at", pg_catalog.now()) + pg_catalog.make_interval(days => p_days);
    UPDATE public."tenant_plans" t SET "setup_ends_at" = v_end, "updated_at" = pg_catalog.now() WHERE t."id" = tp."id";
  ELSE
    IF tp."trial_started_at" IS NULL THEN
      RAISE EXCEPTION 'platform: trial not started' USING ERRCODE = '22023';
    END IF;
    v_end := GREATEST(tp."trial_ends_at", pg_catalog.now()) + pg_catalog.make_interval(days => p_days);
    UPDATE public."tenant_plans" t SET "trial_ends_at" = v_end, "updated_at" = pg_catalog.now() WHERE t."id" = tp."id";
  END IF;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'tenant.lifecycle_extended', p_tenant_id,
          pg_catalog.jsonb_build_object('kind', p_kind, 'days', p_days,
            'from', CASE WHEN p_kind = 'setup' THEN tp."setup_ends_at" ELSE tp."trial_ends_at" END, 'to', v_end), p_ip);
  RETURN v_end;
END
$fn$;--> statement-breakpoint

-- Worker: claims (marks sent, at most once) the tenants on day 5 of setup without a channel, with
-- the owner's email, for the setup reminder. Cross-tenant by design (system job, like 0063).
CREATE FUNCTION public."tenant_setup_reminders_claim"(p_limit integer)
RETURNS TABLE (tenant_id uuid, tenant_name text, owner_email text, setup_ends_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT tp."id" FROM public."tenant_plans" tp
    WHERE tp."setup_ends_at" IS NOT NULL AND tp."trial_started_at" IS NULL AND tp."setup_reminder_sent_at" IS NULL
      AND pg_catalog.now() >= tp."setup_ends_at" - interval '2 days' AND pg_catalog.now() < tp."setup_ends_at"
    ORDER BY tp."setup_ends_at"
    LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 500)
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public."tenant_plans" tp SET "setup_reminder_sent_at" = pg_catalog.now()
    FROM due WHERE tp."id" = due."id"
    RETURNING tp."tenant_id", tp."setup_ends_at"
  )
  SELECT upd."tenant_id", t."name",
         (SELECT u."email" FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
          WHERE m."tenant_id" = upd."tenant_id" AND m."role" = 'owner' ORDER BY m."created_at", m."user_id" LIMIT 1),
         upd."setup_ends_at"
  FROM upd JOIN public."tenants" t ON t."id" = upd."tenant_id";
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."tenant_setup_reminders_claim"(integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_lifecycle_init_trg"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_trial_start"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_extend_lifecycle"(uuid, uuid, text, integer, inet) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."tenant_trial_start"() TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."tenant_setup_reminders_claim"(integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_extend_lifecycle"(uuid, uuid, text, integer, inet) TO crmwsp_app;
  END IF;
END
$$;
