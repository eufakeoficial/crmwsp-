-- users: close the Phase 0 gap (ADR 0002, implementation notes).
--
-- The runtime role may only SELECT users that are members of the current
-- tenant, and only UPDATE its own row (app.user_id, set by
-- withTenant(..., { userId })). No INSERT/DELETE policy: user provisioning is
-- a system job run with a privileged role; with FORCE ROW LEVEL SECURITY RLS
-- denies those commands to every other role regardless of table grants.
--
-- No policy recursion: the subquery reads "memberships", whose policy only
-- references its own tenant_id column (never "users").
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_members_select" ON "users"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."user_id" = "users"."id"
      AND m."tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ));--> statement-breakpoint
CREATE POLICY "self_update" ON "users"
  FOR UPDATE
  USING (
    "id" = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    "id" = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );--> statement-breakpoint
COMMENT ON TABLE "users" IS 'Global identity. RLS: visible only to members of app.tenant_id; updatable only by itself (app.user_id).';
--> statement-breakpoint
-- Column-level grants: the runtime role may only change profile fields of its
-- own row. email (login identity, globally unique) and auth_provider* are
-- changed only by a system job (verified email change flow), never by the
-- app role: otherwise a user could squat another identity's email or probe
-- which emails exist via the unique violation.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE UPDATE, TRUNCATE ON public."users" FROM crmwsp_app;
    GRANT UPDATE ("name") ON public."users" TO crmwsp_app;
  END IF;
END
$$;
