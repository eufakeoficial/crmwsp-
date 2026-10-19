-- ADR 0006: sliding expiration with an ABSOLUTE cap. A session can never live
-- longer than 90 days from created_at, however often it is used: resolve_session
-- rejects sessions older than the cap and never slides expires_at beyond it.
-- Same SECURITY DEFINER hardening as 0006 (CREATE OR REPLACE keeps owner and
-- grants; they are re-applied anyway for clarity).
CREATE OR REPLACE FUNCTION public."resolve_session"(p_token_hash bytea, p_ttl_seconds integer)
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
  v_max interval := pg_catalog.make_interval(days => 90);
BEGIN
  IF p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RETURN;
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 7776000 THEN
    RAISE EXCEPTION 'resolve_session: invalid argument' USING ERRCODE = '22023';
  END IF;
  UPDATE public."sessions" s
  SET "last_seen_at" = pg_catalog.now(),
      "expires_at" = LEAST(pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds),
                           s."created_at" + v_max)
  WHERE s."token_hash" = p_token_hash
    AND s."revoked_at" IS NULL
    AND s."expires_at" > pg_catalog.now()
    AND s."created_at" + v_max > pg_catalog.now()
  RETURNING s."user_id", s."expires_at" INTO v_user, v_expires;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT u."id", u."email", u."name", v_expires FROM public."users" u WHERE u."id" = v_user;
END;
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."resolve_session"(bytea, integer) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."resolve_session"(bytea, integer) TO crmwsp_app;
  END IF;
END
$$;
