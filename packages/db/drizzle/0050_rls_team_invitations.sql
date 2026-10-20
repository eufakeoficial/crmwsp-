-- Row Level Security for team invitations (ADR 0002) plus the SECURITY DEFINER functions of the
-- public accept flow (same conventions as 0006/0026: owned by the migrator, fixed search_path with
-- pg_temp last, schema-qualified objects, EXECUTE only for crmwsp_app, errors without data, never
-- set_config('app.*')). The token itself is never stored: callers pass its SHA-256.
ALTER TABLE "team_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "team_invitations"
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
  FROM pg_class c WHERE c.oid = 'public.team_invitations'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public.team_invitations AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
  -- token_hash is written on insert/resend only; the app never deletes invitations (audit trail).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE DELETE, TRUNCATE ON public."team_invitations" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Public lookup by token hash: ONLY a usable invitation (pending, not expired, active tenant), and
-- only what the accept page shows. The lookup is an exact match on a 32-byte hash through a unique
-- index, so response timing does not depend on how much of a guessed token is right.
CREATE FUNCTION public."team_invitation_lookup"(p_token_hash bytea)
RETURNS TABLE (tenant_name text, email text, role public."membership_role", expires_at timestamptz, has_account boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT t."name", i."email", i."role", i."expires_at",
           EXISTS (SELECT 1 FROM public."users" u WHERE pg_catalog.lower(u."email") = i."email")
    FROM public."team_invitations" i
    JOIN public."tenants" t ON t."id" = i."tenant_id"
    WHERE i."token_hash" = p_token_hash
      AND i."accepted_at" IS NULL AND i."revoked_at" IS NULL
      AND i."expires_at" > pg_catalog.now()
      AND t."status" = 'active';
END
$fn$;--> statement-breakpoint

-- Internal: consumes a usable invitation for an existing user (row-locked, single use).
-- P0002 = invalid/expired/used token, 42501 = the user's email is not the invited one,
-- 23505 = already a member.
CREATE FUNCTION public."team_invitation_consume_internal"(p_token_hash bytea, p_user_id uuid)
RETURNS TABLE (tenant_id uuid, role public."membership_role", invitation_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_inv public."team_invitations"%ROWTYPE;
  v_email text;
BEGIN
  IF p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'team_invitation: invalid' USING ERRCODE = 'P0002';
  END IF;
  SELECT i.* INTO v_inv
  FROM public."team_invitations" i
  JOIN public."tenants" t ON t."id" = i."tenant_id"
  WHERE i."token_hash" = p_token_hash
    AND i."accepted_at" IS NULL AND i."revoked_at" IS NULL
    AND i."expires_at" > pg_catalog.now()
    AND t."status" = 'active'
  FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team_invitation: invalid' USING ERRCODE = 'P0002';
  END IF;
  SELECT pg_catalog.lower(u."email") INTO v_email FROM public."users" u WHERE u."id" = p_user_id;
  IF v_email IS NULL OR v_email <> v_inv."email" THEN
    RAISE EXCEPTION 'team_invitation: email mismatch' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public."memberships" m WHERE m."tenant_id" = v_inv."tenant_id" AND m."user_id" = p_user_id) THEN
    RAISE EXCEPTION 'team_invitation: already a member' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public."memberships" ("tenant_id", "user_id", "role") VALUES (v_inv."tenant_id", p_user_id, v_inv."role");
  UPDATE public."team_invitations" SET "accepted_at" = pg_catalog.now(), "accepted_by" = p_user_id WHERE "id" = v_inv."id";
  INSERT INTO public."audit_events" ("tenant_id", "actor_type", "actor_id", "entity", "entity_id", "action", "diff")
  VALUES (v_inv."tenant_id", 'user', p_user_id, 'team_invitation', v_inv."id", 'team_invitation.accepted',
          pg_catalog.jsonb_build_object('role', v_inv."role"));
  RETURN QUERY SELECT v_inv."tenant_id", v_inv."role", v_inv."id";
END
$fn$;--> statement-breakpoint

-- Accept as an already signed-in user (the API checks the session first).
CREATE FUNCTION public."team_invitation_accept"(p_token_hash bytea, p_user_id uuid)
RETURNS TABLE (tenant_id uuid, role public."membership_role")
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT c."tenant_id", c."role" FROM public."team_invitation_consume_internal"(p_token_hash, p_user_id) c;
$fn$;--> statement-breakpoint

-- Accept by creating the account: user (with the INVITED email, never a caller-chosen one) +
-- credentials + membership in one transaction. 23505 when that email already has an account.
CREATE FUNCTION public."team_invitation_signup"(p_token_hash bytea, p_name text, p_password_hash text)
RETURNS TABLE (user_id uuid, tenant_id uuid, role public."membership_role")
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_email text;
  v_user uuid;
  v_tenant uuid;
  v_role public."membership_role";
BEGIN
  IF p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'team_invitation: invalid' USING ERRCODE = 'P0002';
  END IF;
  IF p_password_hash IS NULL OR pg_catalog.length(p_password_hash) NOT BETWEEN 1 AND 512
     OR p_name IS NULL OR pg_catalog.length(p_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'team_invitation: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT i."email" INTO v_email
  FROM public."team_invitations" i
  WHERE i."token_hash" = p_token_hash
    AND i."accepted_at" IS NULL AND i."revoked_at" IS NULL
    AND i."expires_at" > pg_catalog.now()
  FOR UPDATE;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'team_invitation: invalid' USING ERRCODE = 'P0002';
  END IF;
  BEGIN
    INSERT INTO public."users" ("email", "name", "auth_provider") VALUES (v_email, p_name, 'password')
    RETURNING "id" INTO v_user;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'team_invitation: account exists' USING ERRCODE = '23505';
  END;
  INSERT INTO public."user_credentials" ("user_id", "password_hash") VALUES (v_user, p_password_hash);
  SELECT c."tenant_id", c."role" INTO v_tenant, v_role
  FROM public."team_invitation_consume_internal"(p_token_hash, v_user) c;
  RETURN QUERY SELECT v_user, v_tenant, v_role;
END
$fn$;--> statement-breakpoint

-- After a member is removed: if the user no longer belongs to ANY tenant, revoke all their
-- sessions. Users that still belong to other tenants keep their sessions (they are global); access
-- to the removed tenant is already gone because the tenant guard checks the membership per request.
CREATE FUNCTION public."revoke_sessions_if_orphaned"(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_user_id IS NULL OR EXISTS (SELECT 1 FROM public."memberships" m WHERE m."user_id" = p_user_id) THEN
    RETURN 0;
  END IF;
  UPDATE public."sessions" s SET "revoked_at" = pg_catalog.now()
  WHERE s."user_id" = p_user_id AND s."revoked_at" IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."team_invitation_lookup"(bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."team_invitation_consume_internal"(bytea, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."team_invitation_accept"(bytea, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."team_invitation_signup"(bytea, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."revoke_sessions_if_orphaned"(uuid) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."team_invitation_lookup"(bytea) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."team_invitation_accept"(bytea, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."team_invitation_signup"(bytea, text, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."revoke_sessions_if_orphaned"(uuid) TO crmwsp_app;
  END IF;
END
$$;
