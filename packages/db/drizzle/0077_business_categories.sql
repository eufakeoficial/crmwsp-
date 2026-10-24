-- Business category ("rubro") at onboarding (ADR 0021, T1). Rules are data: business_categories is
-- a platform table seeded from docs/research/politicas-meta-whatsapp-2026-10.md §3 and edited only
-- by platform admins (audited). Same conventions as 0052/0057: SECURITY DEFINER owned by the
-- migrator, fixed search_path with pg_temp last, schema-qualified objects, EXECUTE only for
-- crmwsp_app. The decision rules live in @crmwsp/domain (policies/categories) and are repeated here.

CREATE TABLE public."business_categories" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "action" text NOT NULL,
  "guidance" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "updated_by" uuid REFERENCES public."users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "business_categories_key_check" CHECK ("key" ~ '^[a-z0-9_]{2,64}$'),
  CONSTRAINT "business_categories_action_check" CHECK ("action" IN ('block', 'review', 'warn', 'allow')),
  CONSTRAINT "business_categories_label_check" CHECK (length("label") BETWEEN 1 AND 120),
  CONSTRAINT "business_categories_guidance_check" CHECK ("guidance" IS NULL OR length("guidance") <= 1000)
);--> statement-breakpoint
ALTER TABLE public."business_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public."business_categories" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    REVOKE ALL ON TABLE public."business_categories" FROM crmwsp_app;
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO public."business_categories" ("key", "label", "action", "guidance", "sort_order") VALUES
  ('servicios_profesionales', 'Servicios profesionales y técnicos (reformas, instalaciones, reparaciones, consultoría)', 'warn',
   'Meta no permite vender servicios desde el catálogo de comercio: usa los mensajes y presupuestos, no el catálogo.', 10),
  ('comercio_minorista', 'Comercio minorista de productos físicos', 'allow', NULL, 20),
  ('hosteleria_turismo', 'Hostelería, restauración y turismo', 'allow', NULL, 30),
  ('educacion_formacion', 'Educación y formación', 'allow', NULL, 40),
  ('belleza_estetica', 'Belleza y estética (servicios)', 'allow', NULL, 50),
  ('inmobiliaria', 'Inmobiliaria', 'allow', NULL, 60),
  ('servicios_financieros', 'Servicios financieros (préstamos, seguros, inversiones)', 'warn',
   'Cumple la ley local y nunca pidas por chat números de tarjeta, cuentas bancarias ni documentos de identidad.', 70),
  ('salud_citas', 'Consultorio o clínica que solo agenda citas (sin vender productos)', 'review',
   'Meta prohíbe vender productos o dispositivos de salud; revisaremos que solo uses WhatsApp para citas.', 80),
  ('medicamentos_otc', 'Medicamentos sin receta (OTC)', 'review',
   'Solo en países permitidos, con licencia vigente y nunca a menores de 18.', 90),
  ('alcohol', 'Bebidas alcohólicas', 'review',
   'Solo en países permitidos, con licencia y nunca a menores de 18. No se permite en el catálogo.', 100),
  ('productos_digitales', 'Suscripciones, cuentas o productos digitales descargables', 'review', NULL, 110),
  ('ofertas_empleo', 'Ofertas de empleo', 'review', NULL, 120),
  ('eventos_giftcards_mascotas', 'Entradas a eventos, gift cards o adopción de mascotas', 'review', NULL, 130),
  ('cosmeticos_usados_repuestos', 'Cosméticos usados o piezas de vehículos', 'review', NULL, 140),
  ('armas', 'Armas de fuego, munición o explosivos', 'block', NULL, 200),
  ('drogas_rx', 'Drogas ilegales o medicamentos con receta', 'block', NULL, 210),
  ('salud_productos', 'Productos, dispositivos o suplementos de salud', 'block', NULL, 220),
  ('tabaco', 'Tabaco y vapeo', 'block', NULL, 230),
  ('apuestas', 'Apuestas o juegos con dinero real', 'block', NULL, 240),
  ('cripto', 'Criptomonedas, ICO u opciones binarias', 'block', NULL, 250),
  ('prestamos_payday', 'Préstamos de día de pago (payday)', 'block', NULL, 260),
  ('adultos', 'Productos o servicios para adultos', 'block', NULL, 270),
  ('citas_dating', 'Citas (dating)', 'block', NULL, 280),
  ('mlm', 'Marketing multinivel', 'block', NULL, 290),
  ('moneda_documentos', 'Moneda o documentos reales o falsos', 'block', NULL, 300),
  ('falsificaciones', 'Productos falsificados o medios no autorizados', 'block', NULL, 310),
  ('animales_partes', 'Animales, partes de animales o fluidos corporales', 'block', NULL, 320),
  ('materiales_peligrosos', 'Materiales peligrosos, productos retirados o bienes robados', 'block', NULL, 330),
  ('politica', 'Partidos políticos, candidatos o campañas', 'block', NULL, 340),
  ('fuerzas_seguridad', 'Fuerzas del orden, militares o inteligencia', 'block', NULL, 350),
  ('proveedor_ia', 'Proveedor de IA o asistente de propósito general', 'block', NULL, 360),
  ('otro', 'Otro rubro (descríbelo)', 'review', 'Revisaremos tu rubro antes de que conectes WhatsApp.', 1000);--> statement-breakpoint

ALTER TABLE public."tenants"
  ADD COLUMN "business_category" text REFERENCES public."business_categories"("key") ON UPDATE CASCADE,
  ADD COLUMN "business_category_detail" text,
  ADD COLUMN "category_review_status" text NOT NULL DEFAULT 'none',
  ADD COLUMN "category_review_reason" text,
  ADD COLUMN "business_category_set_at" timestamptz,
  ADD CONSTRAINT "tenants_category_review_status_check" CHECK ("category_review_status" IN ('none', 'pending', 'approved', 'rejected')),
  ADD CONSTRAINT "tenants_business_category_detail_check" CHECK ("business_category_detail" IS NULL OR length("business_category_detail") <= 200);--> statement-breakpoint

-- Only the SECURITY DEFINER functions below (running as the table owner) may change the category
-- columns: the app role can update other tenant columns, never its own review state.
CREATE FUNCTION public."tenants_category_guard"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_owner name;
BEGIN
  IF NEW."business_category" IS DISTINCT FROM OLD."business_category"
     OR NEW."business_category_detail" IS DISTINCT FROM OLD."business_category_detail"
     OR NEW."category_review_status" IS DISTINCT FROM OLD."category_review_status"
     OR NEW."category_review_reason" IS DISTINCT FROM OLD."category_review_reason"
     OR NEW."business_category_set_at" IS DISTINCT FROM OLD."business_category_set_at" THEN
    SELECT pg_catalog.pg_get_userbyid(c."relowner") INTO v_owner FROM pg_catalog.pg_class c WHERE c."oid" = 'public.tenants'::regclass;
    IF current_user <> v_owner THEN
      RAISE EXCEPTION 'tenants: category columns are read-only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER "tenants_category_guard" BEFORE UPDATE ON public."tenants"
  FOR EACH ROW EXECUTE FUNCTION public."tenants_category_guard"();--> statement-breakpoint

-- A tenant whose category review is pending or rejected cannot connect a WhatsApp number.
CREATE FUNCTION public."channel_connections_category_gate"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public."tenants" t WHERE t."id" = NEW."tenant_id" AND t."category_review_status" IN ('pending', 'rejected')) THEN
    RAISE EXCEPTION 'channel: business category review pending' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER "channel_connections_category_gate" BEFORE INSERT ON public."channel_connections"
  FOR EACH ROW EXECUTE FUNCTION public."channel_connections_category_gate"();--> statement-breakpoint

-- Public taxonomy (signup form): active categories only, no admin data.
CREATE FUNCTION public."business_category_list"()
RETURNS TABLE (key text, label text, action text, guidance text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT c."key", c."label", c."action", c."guidance"
  FROM public."business_categories" c
  WHERE c."active"
  ORDER BY c."sort_order", c."key";
$fn$;--> statement-breakpoint

-- Sets the category of the tenant in the current RLS context (app.tenant_id must match). Mirrors
-- decideBusinessCategory/reviewStatusFor/canTenantChangeCategory. Returns the new review status.
CREATE FUNCTION public."tenant_set_business_category"(p_tenant uuid, p_category text, p_detail text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_rule public."business_categories"%ROWTYPE;
  v_t public."tenants"%ROWTYPE;
  v_status text;
  v_detail text := NULLIF(pg_catalog.btrim(coalesce(p_detail, '')), '');
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'category: tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_detail IS NOT NULL AND pg_catalog.length(v_detail) > 200 THEN
    RAISE EXCEPTION 'category: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_rule FROM public."business_categories" c WHERE c."key" = p_category AND c."active";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category: unknown category' USING ERRCODE = '22023';
  END IF;
  IF v_rule."action" = 'block' THEN
    RAISE EXCEPTION 'category: blocked' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public."tenants" t WHERE t."id" = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category: tenant not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_t."category_review_status" IN ('pending', 'rejected') THEN
    RAISE EXCEPTION 'category: locked while under review' USING ERRCODE = '55000';
  END IF;
  IF v_rule."action" <> 'review' THEN
    v_status := 'none';
  ELSIF v_t."category_review_status" = 'approved' AND v_t."business_category" = v_rule."key" THEN
    v_status := 'approved';
  ELSE
    v_status := 'pending';
  END IF;
  UPDATE public."tenants" SET
    "business_category" = v_rule."key",
    "business_category_detail" = v_detail,
    "category_review_status" = v_status,
    "category_review_reason" = CASE WHEN v_status = 'approved' THEN "category_review_reason" ELSE NULL END,
    "business_category_set_at" = pg_catalog.now(),
    "updated_at" = pg_catalog.now()
  WHERE "id" = p_tenant;
  RETURN v_status;
END
$fn$;--> statement-breakpoint

-- Backoffice: full catalog (including inactive rows).
CREATE FUNCTION public."platform_business_category_list"(p_actor uuid)
RETURNS TABLE (key text, label text, action text, guidance text, sort_order integer, active boolean, updated_at timestamptz, tenant_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  RETURN QUERY
    SELECT c."key", c."label", c."action", c."guidance", c."sort_order", c."active", c."updated_at",
           (SELECT pg_catalog.count(*)::integer FROM public."tenants" t WHERE t."business_category" = c."key")
    FROM public."business_categories" c
    ORDER BY c."sort_order", c."key";
END
$fn$;--> statement-breakpoint

-- Backoffice: creates or edits one rule. Never changes existing tenants (never auto-applied). Audited.
CREATE FUNCTION public."platform_business_category_upsert"(
  p_actor uuid, p_key text, p_label text, p_action text, p_guidance text, p_sort_order integer, p_active boolean, p_ip inet
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_before jsonb;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_key IS NULL OR p_key !~ '^[a-z0-9_]{2,64}$' OR p_label IS NULL OR pg_catalog.length(pg_catalog.btrim(p_label)) NOT BETWEEN 1 AND 120
     OR p_action NOT IN ('block', 'review', 'warn', 'allow') OR (p_guidance IS NOT NULL AND pg_catalog.length(p_guidance) > 1000) THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.to_jsonb(c) - 'updated_by' - 'updated_at' INTO v_before FROM public."business_categories" c WHERE c."key" = p_key;
  INSERT INTO public."business_categories" ("key", "label", "action", "guidance", "sort_order", "active", "updated_by", "updated_at")
  VALUES (p_key, pg_catalog.btrim(p_label), p_action, NULLIF(pg_catalog.btrim(coalesce(p_guidance, '')), ''), coalesce(p_sort_order, 500), coalesce(p_active, true), p_actor, pg_catalog.now())
  ON CONFLICT ("key") DO UPDATE SET
    "label" = EXCLUDED."label", "action" = EXCLUDED."action", "guidance" = EXCLUDED."guidance",
    "sort_order" = EXCLUDED."sort_order", "active" = EXCLUDED."active", "updated_by" = p_actor, "updated_at" = pg_catalog.now();
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, 'category.upserted', NULL, pg_catalog.jsonb_build_object(
    'key', p_key, 'before', v_before,
    'after', pg_catalog.jsonb_build_object('label', pg_catalog.btrim(p_label), 'action', p_action, 'active', coalesce(p_active, true))), p_ip);
END
$fn$;--> statement-breakpoint

-- Backoffice review queue: tenants by category review status (default pending).
CREATE FUNCTION public."platform_category_review_list"(p_actor uuid, p_status text)
RETURNS TABLE (
  tenant_id uuid, name text, slug text, tenant_status text, category text, category_label text, category_action text,
  detail text, review_status text, review_reason text, set_at timestamptz, owner_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_status text := coalesce(p_status, 'pending');
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF v_status NOT IN ('pending', 'approved', 'rejected', 'none', 'unset') THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT t."id", t."name", t."slug", t."status", t."business_category", c."label", c."action",
           t."business_category_detail", t."category_review_status", t."category_review_reason", t."business_category_set_at",
           (SELECT u."email" FROM public."memberships" m JOIN public."users" u ON u."id" = m."user_id"
            WHERE m."tenant_id" = t."id" AND m."role" = 'owner' ORDER BY m."created_at", m."user_id" LIMIT 1)
    FROM public."tenants" t
    LEFT JOIN public."business_categories" c ON c."key" = t."business_category"
    WHERE CASE WHEN v_status = 'unset' THEN t."business_category" IS NULL
               ELSE t."category_review_status" = v_status AND t."business_category" IS NOT NULL END
    ORDER BY t."business_category_set_at" DESC NULLS LAST, t."id"
    LIMIT 500;
END
$fn$;--> statement-breakpoint

-- Backoffice: approve or reject a pending category review (reject needs a reason). Audited.
CREATE FUNCTION public."platform_category_review_decide"(p_actor uuid, p_tenant uuid, p_approve boolean, p_reason text, p_ip inet)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_t public."tenants"%ROWTYPE;
  v_reason text := NULLIF(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_next text;
BEGIN
  PERFORM public."platform_assert_admin_internal"(p_actor);
  IF p_approve IS NULL OR (NOT p_approve AND v_reason IS NULL) OR (v_reason IS NOT NULL AND pg_catalog.length(v_reason) > 500) THEN
    RAISE EXCEPTION 'platform: invalid argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public."tenants" t WHERE t."id" = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform: tenant not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_t."category_review_status" <> 'pending' THEN
    RAISE EXCEPTION 'platform: category review is not pending' USING ERRCODE = '55000';
  END IF;
  v_next := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  UPDATE public."tenants" SET "category_review_status" = v_next, "category_review_reason" = v_reason, "updated_at" = pg_catalog.now()
  WHERE "id" = p_tenant;
  INSERT INTO public."platform_audit_events" ("actor_id", "action", "tenant_id", "diff", "ip")
  VALUES (p_actor, CASE WHEN p_approve THEN 'tenant.category_approved' ELSE 'tenant.category_rejected' END, p_tenant,
          pg_catalog.jsonb_build_object('category', v_t."business_category", 'from', 'pending', 'to', v_next, 'reason', v_reason), p_ip);
  RETURN v_next;
END
$fn$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public."business_category_list"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."tenant_set_business_category"(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_business_category_list"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_business_category_upsert"(uuid, text, text, text, text, integer, boolean, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_category_review_list"(uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."platform_category_review_decide"(uuid, uuid, boolean, text, inet) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public."channel_connections_category_gate"() FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app') THEN
    GRANT EXECUTE ON FUNCTION public."business_category_list"() TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."tenant_set_business_category"(uuid, text, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_business_category_list"(uuid) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_business_category_upsert"(uuid, text, text, text, text, integer, boolean, inet) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_category_review_list"(uuid, text) TO crmwsp_app;
    GRANT EXECUTE ON FUNCTION public."platform_category_review_decide"(uuid, uuid, boolean, text, inet) TO crmwsp_app;
  END IF;
END
$$;
