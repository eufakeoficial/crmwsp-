-- Transactional email wiring (odd/tasks/wire-emails.md).
--  * email_dispatches: at-most-once ledger of lifecycle/billing emails (dedupe_key), written by the
--    worker AFTER the business transaction committed. A failed email never rolls back a payment.
--  * password_reset_tokens: single-use, hashed (SHA-256), 30-minute tokens (ADR 0006 extension).
-- Both are SYSTEM-ONLY tables like user_credentials/sessions (0006): RLS forced, only the owner
-- policy, no privilege for crmwsp_app; access goes through the SECURITY DEFINER functions below.

CREATE TABLE public."email_dispatches" (
  "dedupe_key" text PRIMARY KEY,
  "template" text NOT NULL,
  "tenant_id" uuid REFERENCES public."tenants"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "email_dispatches_key_check" CHECK (pg_catalog.length("dedupe_key") BETWEEN 1 AND 200),
  CONSTRAINT "email_dispatches_template_check" CHECK ("template" ~ '^[a-z0-9-]{1,64}$')
);--> statement-breakpoint
CREATE INDEX "email_dispatches_tenant_idx" ON public."email_dispatches" ("tenant_id", "created_at");--> statement-breakpoint

CREATE TABLE public."password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "token_hash" bytea NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "ip" inet,
  CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "password_reset_tokens_token_hash_len_check" CHECK (octet_length("token_hash") = 32)
);--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON public."password_reset_tokens" ("user_id", "created_at");--> statement-breakpoint

ALTER TABLE public."email_dispatches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."email_dispatches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."password_reset_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."password_reset_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public."email_dispatches" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public."password_reset_tokens" FROM PUBLIC;--> statement-breakpoint
DO $$
DECLARE
  t text;
  v_owner text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_dispatches', 'password_reset_tokens']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."email_dispatches" FROM crmwsp_app;
    REVOKE ALL ON TABLE public."password_reset_tokens" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

-- Claims a dedupe key: true the first time only (the caller sends), false on every replay.
CREATE FUNCTION public."email_dispatch_claim"(p_key text, p_template text, p_tenant uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public."email_dispatches" ("dedupe_key", "template", "tenant_id")
  VALUES (p_key, p_template, p_tenant)
  ON CONFLICT ("dedupe_key") DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END
$fn$;--> statement-breakpoint

-- Worker (cross-tenant system job, like 0068): active tenants whose trial or paid period is near a
-- lifecycle email moment, with the first owner. Only a bounded recent window, so a deploy never
-- mails historic tenants.
CREATE FUNCTION public."email_lifecycle_candidates"(p_limit integer)
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
    AND (
      (paid."paid_until" IS NOT NULL AND paid."paid_until" BETWEEN (pg_catalog.now() - interval '7 days')::date AND (pg_catalog.now() + interval '4 days')::date)
      OR (paid."paid_until" IS NULL AND tp."trial_started_at" IS NOT NULL AND tp."trial_ends_at" > pg_catalog.now() - interval '7 days')
    )
  ORDER BY t."id"
  LIMIT LEAST(GREATEST(coalesce(p_limit, 500), 1), 2000);
$fn$;--> statement-breakpoint

-- Worker: charges settled as paid in the last p_hours (provider or coupon) not yet emailed.
CREATE FUNCTION public."email_recent_paid_charges"(p_hours integer, p_limit integer)
RETURNS TABLE (
  charge_id uuid, tenant_id uuid, tenant_name text, owner_email text, plan text, period_days integer,
  price_amount text, price_currency text, verified_by text, provider_payment_id text, period_start date, period_end date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT s."id", s."tenant_id", t."name",
         (SELECT u."email" FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
          WHERE m."tenant_id" = s."tenant_id" AND m."role" = 'owner' ORDER BY m."created_at", m."user_id" LIMIT 1),
         s."plan", s."period_days", s."price_amount"::text, s."price_currency", s."verified_by", s."provider_payment_id",
         s."period_start", s."period_end"
  FROM public."subscription_charges" s
  JOIN public."tenants" t ON t."id" = s."tenant_id"
  WHERE s."status" = 'paid' AND s."verified_by" IN ('webhook', 'reconciliation', 'coupon')
    AND s."paid_at" > pg_catalog.now() - pg_catalog.make_interval(hours => LEAST(GREATEST(coalesce(p_hours, 48), 1), 168))
    AND NOT EXISTS (SELECT 1 FROM public."email_dispatches" d WHERE d."dedupe_key" = 'charge-paid:' || s."id"::text)
  ORDER BY s."paid_at"
  LIMIT LEAST(GREATEST(coalesce(p_limit, 100), 1), 500);
$fn$;--> statement-breakpoint

-- Worker: referral rewards granted in the last p_hours not yet emailed, with the REFERRER's owner.
CREATE FUNCTION public."email_recent_referral_rewards"(p_hours integer, p_limit integer)
RETURNS TABLE (reward_id uuid, tenant_id uuid, owner_email text, owner_name text, referred_name text, percent integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT r."id", r."tenant_id",
         (SELECT u."email" FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
          WHERE m."tenant_id" = r."tenant_id" AND m."role" = 'owner' ORDER BY m."created_at", m."user_id" LIMIT 1),
         (SELECT u."name" FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
          WHERE m."tenant_id" = r."tenant_id" AND m."role" = 'owner' ORDER BY m."created_at", m."user_id" LIMIT 1),
         rt."name", r."percent"
  FROM public."referral_rewards" r
  JOIN public."tenants" rt ON rt."id" = r."referred_tenant_id"
  WHERE r."status" = 'available'
    AND r."created_at" > pg_catalog.now() - pg_catalog.make_interval(hours => LEAST(GREATEST(coalesce(p_hours, 48), 1), 168))
    AND NOT EXISTS (SELECT 1 FROM public."email_dispatches" d WHERE d."dedupe_key" = 'referral-reward:' || r."id"::text)
  ORDER BY r."created_at"
  LIMIT LEAST(GREATEST(coalesce(p_limit, 100), 1), 500);
$fn$;--> statement-breakpoint

-- Password reset request: for an existing password account, invalidates its unused tokens and
-- stores the new token hash. Returns the user (to email) or no row; the caller answers the same
-- either way (no user enumeration).
CREATE FUNCTION public."password_reset_request"(p_email text, p_token_hash bytea, p_ttl_seconds integer, p_ip inet)
RETURNS TABLE (user_id uuid, email text, name text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
BEGIN
  IF p_email IS NULL OR pg_catalog.length(p_email) > 320 OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RETURN;
  END IF;
  SELECT u."id" INTO v_user FROM public."users" u JOIN public."user_credentials" c ON c."user_id" = u."id"
  WHERE pg_catalog.lower(u."email") = pg_catalog.lower(p_email);
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  UPDATE public."password_reset_tokens" t SET "used_at" = pg_catalog.now()
  WHERE t."user_id" = v_user AND t."used_at" IS NULL;
  INSERT INTO public."password_reset_tokens" ("user_id", "token_hash", "expires_at", "ip")
  VALUES (v_user, p_token_hash, pg_catalog.now() + pg_catalog.make_interval(secs => LEAST(GREATEST(coalesce(p_ttl_seconds, 1800), 60), 3600)), p_ip);
  RETURN QUERY SELECT u."id", u."email", u."name" FROM public."users" u WHERE u."id" = v_user;
END
$fn$;--> statement-breakpoint

-- Consumes a reset token (single use, unexpired), sets the new password hash and revokes every
-- active session of the user. Returns the user id, or NULL for an unknown/used/expired token.
CREATE FUNCTION public."password_reset_consume"(p_token_hash bytea, p_password_hash text)
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
  IF p_token_hash IS NULL OR p_password_hash IS NULL OR pg_catalog.length(p_password_hash) < 20 THEN
    RETURN NULL;
  END IF;
  SELECT t."id", t."user_id" INTO v_id, v_user FROM public."password_reset_tokens" t
  WHERE t."token_hash" = p_token_hash AND t."used_at" IS NULL AND t."expires_at" > pg_catalog.now()
  FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public."password_reset_tokens" SET "used_at" = pg_catalog.now() WHERE "id" = v_id;
  UPDATE public."user_credentials" SET "password_hash" = p_password_hash, "updated_at" = pg_catalog.now() WHERE "user_id" = v_user;
  UPDATE public."sessions" SET "revoked_at" = pg_catalog.now() WHERE "user_id" = v_user AND "revoked_at" IS NULL;
  RETURN v_user;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."email_dispatch_claim"(text, text, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."email_lifecycle_candidates"(integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."email_recent_paid_charges"(integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."email_recent_referral_rewards"(integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."password_reset_request"(text, bytea, integer, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."password_reset_consume"(bytea, text) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."email_dispatch_claim"(text, text, uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."email_lifecycle_candidates"(integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."email_recent_paid_charges"(integer, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."email_recent_referral_rewards"(integer, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."password_reset_request"(text, bytea, integer, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."password_reset_consume"(bytea, text) TO crmwsp_app;
  END IF;
END
$$;
