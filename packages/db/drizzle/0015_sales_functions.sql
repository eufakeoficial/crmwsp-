-- F3-B functions: document numbering, stock reservation, default pipeline seed.

-- Gapless per-tenant/kind/year numbering. SECURITY INVOKER: the UPSERT runs under the
-- caller's RLS, and the row lock taken by ON CONFLICT DO UPDATE serializes concurrent
-- transactions until commit, so two callers never get the same number and a rollback
-- returns the number (no gaps).
CREATE FUNCTION public."next_document_number"(p_kind text, p_year integer)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  v_value integer;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'next_document_number: no tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('quote', 'order') OR p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'next_document_number: invalid argument' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."document_sequences" AS s ("tenant_id", "kind", "year", "last_value")
  VALUES (v_tenant, p_kind, p_year, 1)
  ON CONFLICT ("tenant_id", "kind", "year") DO UPDATE SET "last_value" = s."last_value" + 1
  RETURNING s."last_value" INTO v_value;
  RETURN CASE p_kind WHEN 'quote' THEN 'PRE' ELSE 'PED' END
    || '-' || p_year::text || '-' || pg_catalog.lpad(v_value::text, 4, '0');
END;
$fn$;--> statement-breakpoint

CREATE FUNCTION public."next_quote_number"(p_year integer)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$ SELECT public."next_document_number"('quote', p_year); $fn$;--> statement-breakpoint

-- Stock. All three are SECURITY INVOKER (RLS of the caller) and idempotent by orders.stock_state.
-- Lines are aggregated per variant and locked in id order (no deadlocks between orders).
-- Only variants of products with track_stock are touched.
-- reserve_stock raises P0001 'insufficient_stock:<variant_id>' and the whole call is atomic.
CREATE FUNCTION public."reserve_stock"(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_state public."order_stock_state";
  r record;
BEGIN
  SELECT o."stock_state" INTO v_state FROM public."orders" o WHERE o."id" = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_state <> 'none' THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT i."variant_id", pg_catalog.sum(i."quantity")::integer AS qty
    FROM public."order_items" i
    JOIN public."product_variants" v ON v."tenant_id" = i."tenant_id" AND v."id" = i."variant_id"
    JOIN public."products" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
    WHERE i."order_id" = p_order_id AND p."track_stock"
    GROUP BY i."variant_id"
    ORDER BY i."variant_id"
  LOOP
    UPDATE public."product_variants" v
       SET "stock_reserved" = v."stock_reserved" + r.qty, "updated_at" = pg_catalog.now()
     WHERE v."id" = r."variant_id" AND v."is_active"
       AND v."stock_on_hand" - v."stock_reserved" >= r.qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient_stock:%', r."variant_id" USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public."stock_movements" ("tenant_id", "variant_id", "delta", "reason", "ref_id")
    SELECT o."tenant_id", r."variant_id", r.qty, 'order_reserved', p_order_id
    FROM public."orders" o WHERE o."id" = p_order_id;
  END LOOP;
  UPDATE public."orders" SET "stock_state" = 'reserved', "updated_at" = pg_catalog.now() WHERE "id" = p_order_id;
END;
$fn$;--> statement-breakpoint

-- On payment: on_hand -= q and reserved -= q. A never-reserved order is reserved first.
CREATE FUNCTION public."commit_stock"(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_state public."order_stock_state";
  r record;
BEGIN
  SELECT o."stock_state" INTO v_state FROM public."orders" o WHERE o."id" = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_state = 'committed' THEN
    RETURN;
  END IF;
  IF v_state = 'released' THEN
    RAISE EXCEPTION 'stock_already_released' USING ERRCODE = 'P0001';
  END IF;
  IF v_state = 'none' THEN
    PERFORM public."reserve_stock"(p_order_id);
  END IF;
  FOR r IN
    SELECT i."variant_id", pg_catalog.sum(i."quantity")::integer AS qty
    FROM public."order_items" i
    JOIN public."product_variants" v ON v."tenant_id" = i."tenant_id" AND v."id" = i."variant_id"
    JOIN public."products" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
    WHERE i."order_id" = p_order_id AND p."track_stock"
    GROUP BY i."variant_id"
    ORDER BY i."variant_id"
  LOOP
    UPDATE public."product_variants" v
       SET "stock_on_hand" = v."stock_on_hand" - r.qty,
           "stock_reserved" = v."stock_reserved" - r.qty,
           "updated_at" = pg_catalog.now()
     WHERE v."id" = r."variant_id";
    INSERT INTO public."stock_movements" ("tenant_id", "variant_id", "delta", "reason", "ref_id")
    SELECT o."tenant_id", r."variant_id", -r.qty, 'order_committed', p_order_id
    FROM public."orders" o WHERE o."id" = p_order_id;
  END LOOP;
  UPDATE public."orders" SET "stock_state" = 'committed', "updated_at" = pg_catalog.now() WHERE "id" = p_order_id;
END;
$fn$;--> statement-breakpoint

-- On cancel: reserved -= q. Only from 'reserved'; 'none', 'released' and 'committed' are no-ops
-- (restocking a paid order is a return flow, out of scope here).
CREATE FUNCTION public."release_stock"(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_state public."order_stock_state";
  r record;
BEGIN
  SELECT o."stock_state" INTO v_state FROM public."orders" o WHERE o."id" = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_state <> 'reserved' THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT i."variant_id", pg_catalog.sum(i."quantity")::integer AS qty
    FROM public."order_items" i
    JOIN public."product_variants" v ON v."tenant_id" = i."tenant_id" AND v."id" = i."variant_id"
    JOIN public."products" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
    WHERE i."order_id" = p_order_id AND p."track_stock"
    GROUP BY i."variant_id"
    ORDER BY i."variant_id"
  LOOP
    UPDATE public."product_variants" v
       SET "stock_reserved" = v."stock_reserved" - r.qty, "updated_at" = pg_catalog.now()
     WHERE v."id" = r."variant_id";
    INSERT INTO public."stock_movements" ("tenant_id", "variant_id", "delta", "reason", "ref_id")
    SELECT o."tenant_id", r."variant_id", -r.qty, 'order_released', p_order_id
    FROM public."orders" o WHERE o."id" = p_order_id;
  END LOOP;
  UPDATE public."orders" SET "stock_state" = 'released', "updated_at" = pg_catalog.now() WHERE "id" = p_order_id;
END;
$fn$;--> statement-breakpoint

-- Default pipeline seed. The internal function trusts its caller (signup_tenant) and is
-- not granted to the app role; the public wrapper only seeds the CURRENT tenant, so the
-- app role cannot write into another tenant through a SECURITY DEFINER function.
-- Idempotent: ON CONFLICT on the one-default-per-tenant partial unique index.
CREATE FUNCTION public."seed_default_pipeline_internal"(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_pipeline uuid;
BEGIN
  INSERT INTO public."pipelines" ("tenant_id", "name", "is_default")
  VALUES (p_tenant_id, 'Ventas', true)
  ON CONFLICT ("tenant_id") WHERE "is_default" DO NOTHING
  RETURNING "id" INTO v_pipeline;
  IF v_pipeline IS NULL THEN
    SELECT p."id" INTO v_pipeline FROM public."pipelines" p
    WHERE p."tenant_id" = p_tenant_id AND p."is_default";
    RETURN v_pipeline;
  END IF;
  INSERT INTO public."pipeline_stages" ("tenant_id", "pipeline_id", "key", "name", "position", "kind")
  VALUES
    (p_tenant_id, v_pipeline, 'new', 'Nuevo', 1, 'open'),
    (p_tenant_id, v_pipeline, 'contacted', 'Contactado', 2, 'open'),
    (p_tenant_id, v_pipeline, 'qualified', 'Calificado', 3, 'open'),
    (p_tenant_id, v_pipeline, 'quote_sent', 'Presupuesto enviado', 4, 'open'),
    (p_tenant_id, v_pipeline, 'negotiation', 'Negociación', 5, 'open'),
    (p_tenant_id, v_pipeline, 'won', 'Ganado', 6, 'won'),
    (p_tenant_id, v_pipeline, 'lost', 'Perdido', 7, 'lost');
  RETURN v_pipeline;
END;
$fn$;--> statement-breakpoint

CREATE FUNCTION public."seed_default_pipeline"(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF p_tenant_id IS NULL
     OR p_tenant_id IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'seed_default_pipeline: tenant mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN public."seed_default_pipeline_internal"(p_tenant_id);
END;
$fn$;--> statement-breakpoint

-- signup_tenant: same signature and behaviour as 0006, plus the default pipeline.
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
  PERFORM public."seed_default_pipeline_internal"(v_tenant);
  RETURN QUERY SELECT v_user, v_tenant;
END;
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."next_document_number"(text, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."next_quote_number"(integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."reserve_stock"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."commit_stock"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."release_stock"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."seed_default_pipeline_internal"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."seed_default_pipeline"(uuid) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."next_document_number"(text, integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."next_quote_number"(integer) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."reserve_stock"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."commit_stock"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."release_stock"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."seed_default_pipeline"(uuid) TO crmwsp_app;
  END IF;
END
$$;
