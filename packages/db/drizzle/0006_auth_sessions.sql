CREATE TABLE "user_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint

-- Auth (ADR 0006). user_credentials and sessions are SYSTEM-ONLY tables:
-- the runtime role (crmwsp_app) has no table privileges and no RLS policy on
-- them, so it can never read password hashes or session token hashes. All
-- access goes through the SECURITY DEFINER functions below (same pattern as
-- ingest_inbound_event in 0005): owned by the migrator, fixed search_path
-- (pg_temp last), schema-qualified objects, EXECUTE revoked from PUBLIC and
-- granted only to crmwsp_app, error messages without data. As the owner they
-- are covered by the "system_owner" policies (works with a NOSUPERUSER
-- NOBYPASSRLS migrator) and never call set_config('app.*'), which would leak
-- into the caller's transaction.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_token_hash_len_check" CHECK (octet_length("token_hash") = 32);--> statement-breakpoint
ALTER TABLE "user_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
DECLARE
  t text;
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH t IN ARRAY ARRAY['user_credentials', 'sessions']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
  END LOOP;
  -- Default privileges (bootstrap-roles.sql) granted DML on new tables: take it back.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON public."user_credentials" FROM crmwsp_app;
    REVOKE ALL ON public."sessions" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Returns the user id and password hash for an email (case-insensitive), or
-- no row. The caller verifies the hash in Node and MUST spend the same time
-- when no row comes back (verify against a dummy hash).
CREATE FUNCTION public."auth_login"(p_email text)
RETURNS TABLE (user_id uuid, password_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT u."id", c."password_hash"
  FROM public."users" u
  JOIN public."user_credentials" c ON c."user_id" = u."id"
  WHERE pg_catalog.lower(u."email") = pg_catalog.lower(p_email)
    AND p_email IS NOT NULL
    AND pg_catalog.length(p_email) <= 320;
$fn$;--> statement-breakpoint

-- Creates a session for an existing user. ttl between 1 minute and 90 days.
CREATE FUNCTION public."create_session"(
  p_user_id uuid,
  p_token_hash bytea,
  p_ip inet,
  p_user_agent text,
  p_ttl_seconds integer
)
RETURNS TABLE (session_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_token_hash IS NULL OR p_ttl_seconds IS NULL THEN
    RAISE EXCEPTION 'create_session: arguments must not be null' USING ERRCODE = '22004';
  END IF;
  IF pg_catalog.octet_length(p_token_hash) <> 32 OR p_ttl_seconds < 60 OR p_ttl_seconds > 7776000 THEN
    RAISE EXCEPTION 'create_session: invalid argument' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."sessions" ("user_id", "token_hash", "expires_at", "ip", "user_agent")
  VALUES (p_user_id, p_token_hash, pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds),
          p_ip, pg_catalog.left(p_user_agent, 512))
  RETURNING "id", "expires_at" INTO v_id, v_expires;
  RETURN QUERY SELECT v_id, v_expires;
END;
$fn$;--> statement-breakpoint

-- Resolves a valid (not revoked, not expired) session and slides its
-- expiration: expires_at = now() + ttl. Returns no row otherwise.
CREATE FUNCTION public."resolve_session"(p_token_hash bytea, p_ttl_seconds integer)
RETURNS TABLE (user_id uuid, email text, name text, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_expires timestamptz;
BEGIN
  IF p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RETURN;
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 7776000 THEN
    RAISE EXCEPTION 'resolve_session: invalid argument' USING ERRCODE = '22023';
  END IF;
  UPDATE public."sessions" s
  SET "last_seen_at" = pg_catalog.now(),
      "expires_at" = pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds)
  WHERE s."token_hash" = p_token_hash
    AND s."revoked_at" IS NULL
    AND s."expires_at" > pg_catalog.now()
  RETURNING s."user_id", s."expires_at" INTO v_user, v_expires;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT u."id", u."email", u."name", v_expires FROM public."users" u WHERE u."id" = v_user;
END;
$fn$;--> statement-breakpoint

-- Revokes a session (logout). Returns true if an active session was revoked.
CREATE FUNCTION public."revoke_session"(p_token_hash bytea)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE public."sessions" s
  SET "revoked_at" = pg_catalog.now()
  WHERE s."token_hash" = p_token_hash AND s."revoked_at" IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$fn$;--> statement-breakpoint

-- Memberships of a user across tenants (for /auth/me and the tenant guard).
CREATE FUNCTION public."list_user_tenants"(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, slug text, name text, role public."membership_role")
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT t."id", t."slug", t."name", m."role"
  FROM public."memberships" m
  JOIN public."tenants" t ON t."id" = m."tenant_id"
  WHERE m."user_id" = p_user_id
  ORDER BY t."created_at", t."id";
$fn$;--> statement-breakpoint

-- Self-service signup: user + credentials + tenant + owner membership in one
-- transaction (the function runs inside the caller's statement). A taken
-- email OR slug raises the SAME generic error (SQLSTATE 23505, no data) so the
-- error does not tell which one exists.
CREATE FUNCTION public."signup_tenant"(
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
  BEGIN
    INSERT INTO public."users" ("email", "name", "auth_provider")
    VALUES (pg_catalog.lower(p_email), p_name, 'password')
    RETURNING "id" INTO v_user;
    INSERT INTO public."tenants" ("slug", "name")
    VALUES (p_tenant_slug, p_tenant_name)
    RETURNING "id" INTO v_tenant;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'signup_tenant: signup rejected' USING ERRCODE = '23505';
  END;
  INSERT INTO public."user_credentials" ("user_id", "password_hash") VALUES (v_user, p_password_hash);
  INSERT INTO public."memberships" ("tenant_id", "user_id", "role") VALUES (v_tenant, v_user, 'owner');
  RETURN QUERY SELECT v_user, v_tenant;
END;
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."auth_login"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."create_session"(uuid, bytea, inet, text, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."resolve_session"(bytea, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."revoke_session"(bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."list_user_tenants"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."signup_tenant"(text, text, text, text, text) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."auth_login"(text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."create_session"(uuid, bytea, inet, text, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."resolve_session"(bytea, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."revoke_session"(bytea) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."list_user_tenants"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."signup_tenant"(text, text, text, text, text) TO crmwsp_app;
  END IF;
END
$$;
