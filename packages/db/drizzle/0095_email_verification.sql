-- Email verification on signup (odd/tasks/verificacion-correo.md).
--  * users.email_verified_at: NULL until the user confirms the address. Every user that exists when
--    this migration runs is grandfathered as verified (backfilled to now()).
--  * email_verification_tokens: single-use, hashed (SHA-256), 24-hour tokens, same model as
--    password_reset_tokens (0074). SYSTEM-ONLY table: RLS forced, only the owner policy, no
--    privilege for crmwsp_app; access goes through the SECURITY DEFINER functions below.
--  * Product rule: a tenant cannot connect a WhatsApp channel until its owner's email is verified
--    (tenant_owner_email_verified, checked by the API).

ALTER TABLE public."users" ADD COLUMN "email_verified_at" timestamptz;--> statement-breakpoint
UPDATE public."users" SET "email_verified_at" = pg_catalog.now() WHERE "email_verified_at" IS NULL;--> statement-breakpoint

CREATE TABLE public."email_verification_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "token_hash" bytea NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "email_verification_tokens_token_hash_len_check" CHECK (octet_length("token_hash") = 32)
);--> statement-breakpoint
CREATE INDEX "email_verification_tokens_user_idx" ON public."email_verification_tokens" ("user_id", "created_at");--> statement-breakpoint

ALTER TABLE public."email_verification_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."email_verification_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public."email_verification_tokens" FROM PUBLIC;--> statement-breakpoint
DO $$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = 'public.email_verification_tokens'::regclass;
  EXECUTE format('CREATE POLICY "system_owner" ON public.email_verification_tokens AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_owner);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."email_verification_tokens" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Issues a verification token for a not-yet-verified user: invalidates its unused tokens and stores
-- the new hash. Returns the user (to email) or no row (unknown or already verified user).
CREATE FUNCTION public."email_verification_issue"(p_user_id uuid, p_token_hash bytea, p_ttl_seconds integer)
RETURNS TABLE (user_id uuid, email text, name text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF p_user_id IS NULL OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."users" u WHERE u."id" = p_user_id AND u."email_verified_at" IS NULL) THEN
    RETURN;
  END IF;
  UPDATE public."email_verification_tokens" t SET "used_at" = pg_catalog.now()
  WHERE t."user_id" = p_user_id AND t."used_at" IS NULL;
  INSERT INTO public."email_verification_tokens" ("user_id", "token_hash", "expires_at")
  VALUES (p_user_id, p_token_hash, pg_catalog.now() + pg_catalog.make_interval(secs => LEAST(GREATEST(coalesce(p_ttl_seconds, 86400), 60), 172800)));
  RETURN QUERY SELECT u."id", u."email", u."name" FROM public."users" u WHERE u."id" = p_user_id;
END
$fn$;--> statement-breakpoint

-- Consumes a verification token (single use, unexpired) and marks the user's email verified.
-- Returns the user id, or NULL for an unknown/used/expired token.
CREATE FUNCTION public."email_verification_consume"(p_token_hash bytea)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_user uuid;
BEGIN
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RETURN NULL;
  END IF;
  SELECT t."id", t."user_id" INTO v_id, v_user FROM public."email_verification_tokens" t
  WHERE t."token_hash" = p_token_hash AND t."used_at" IS NULL AND t."expires_at" > pg_catalog.now()
  FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public."email_verification_tokens" SET "used_at" = pg_catalog.now() WHERE "id" = v_id;
  UPDATE public."users" SET "email_verified_at" = coalesce("email_verified_at", pg_catalog.now()) WHERE "id" = v_user;
  RETURN v_user;
END
$fn$;--> statement-breakpoint

-- When the user's email was verified (NULL = not verified or unknown user).
CREATE FUNCTION public."user_email_verified_at"(p_user_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT u."email_verified_at" FROM public."users" u WHERE u."id" = p_user_id;
$fn$;--> statement-breakpoint

-- Whether the first owner of the tenant has a verified email. Only answers for the tenant of the
-- caller's transaction context (app.tenant_id = p_tenant_id, like 0094); false otherwise.
CREATE FUNCTION public."tenant_owner_email_verified"(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_ctx uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR v_ctx <> p_tenant_id THEN
    RETURN false;
  END IF;
  RETURN coalesce((
    SELECT u."email_verified_at" IS NOT NULL
    FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
    WHERE m."tenant_id" = p_tenant_id AND m."role" = 'owner'
    ORDER BY m."created_at", m."user_id" LIMIT 1
  ), false);
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."email_verification_issue"(uuid, bytea, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."email_verification_consume"(bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."user_email_verified_at"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_owner_email_verified"(uuid) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."email_verification_issue"(uuid, bytea, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."email_verification_consume"(bytea) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."user_email_verified_at"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."tenant_owner_email_verified"(uuid) TO crmwsp_app;
  END IF;
END
$$;
