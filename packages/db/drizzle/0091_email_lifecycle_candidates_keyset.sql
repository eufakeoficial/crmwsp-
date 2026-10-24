-- Lifecycle email starvation fix (odd/tasks/fix-prelanzamiento.md, F2).
-- email_lifecycle_candidates (0074) always returned the same first 500 tenants by id, so tenant
-- #501+ never got a trial/renewal email. This keyset variant pages with `t.id > p_after`; the worker
-- loops until a short page (bounded per tick). Same filters and SECURITY DEFINER rules as 0074.

CREATE FUNCTION public."email_lifecycle_candidates_page"(p_after uuid, p_limit integer)
RETURNS TABLE (
  tenant_id uuid, tenant_name text, owner_email text, owner_name text, plan text, paid_until date,
  setup_ends_at timestamptz, trial_started_at timestamptz, trial_ends_at timestamptz, trial_denied_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  WITH paid AS (
    SELECT sp."tenant_id", pg_catalog.max(sp."period_end") AS "paid_until"
    FROM public."subscription_payments" sp GROUP BY sp."tenant_id"
  )
  SELECT t."id", t."name",
         (SELECT u."email" FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
          WHERE m."tenant_id" = t."id" AND m."role" = 'owner' ORDER BY m."created_at", m."user_id" LIMIT 1),
         (SELECT u."name" FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
          WHERE m."tenant_id" = t."id" AND m."role" = 'owner' ORDER BY m."created_at", m."user_id" LIMIT 1),
         tp."plan", paid."paid_until", tp."setup_ends_at", tp."trial_started_at", tp."trial_ends_at", tp."trial_denied_at"
  FROM public."tenants" t
  JOIN public."tenant_plans" tp ON tp."tenant_id" = t."id"
  LEFT JOIN paid ON paid."tenant_id" = t."id"
  WHERE t."status" = 'active'
    AND (p_after IS NULL OR t."id" > p_after)
    AND (
      (paid."paid_until" IS NOT NULL AND paid."paid_until" BETWEEN (pg_catalog.now() - interval '7 days')::date AND (pg_catalog.now() + interval '4 days')::date)
      OR (paid."paid_until" IS NULL AND tp."trial_started_at" IS NOT NULL AND tp."trial_ends_at" > pg_catalog.now() - interval '7 days')
    )
  ORDER BY t."id"
  LIMIT LEAST(GREATEST(coalesce(p_limit, 500), 1), 2000);
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."email_lifecycle_candidates_page"(uuid, integer) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."email_lifecycle_candidates_page"(uuid, integer) TO crmwsp_app;
  END IF;
END
$$;
