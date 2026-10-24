# ADR 0021 — Políticas de Meta: rubros, salvaguardas de mensajería y monitor de políticas

**Estado:** aceptado · **Fecha:** 2026-10-24 · **Relacionado:** ADR 0004, ADR 0011, ADR 0014
**Fuente:** `docs/research/politicas-meta-whatsapp-2026-10.md` (investigación técnica, no asesoría legal)

## Contexto
Meta puede limitar o dar de baja números y portafolios por rubros prohibidos, mala calidad o quejas.
Un tenant con un rubro prohibido o con envíos de baja calidad pone en riesgo su número y, si comparte
portafolio, el de otros. La lista de Meta cambia sin aviso, así que las reglas no pueden ser código fijo.

## Decisión — T1: rubro del negocio
- **Reglas como datos.** Tabla de plataforma `business_categories (key, label, action, guidance,
  sort_order, active)` sembrada desde la tabla §3 de la investigación (migración 0077). `action`:
  `block` (BLOQUEAR), `review` (REVISIÓN), `warn` (ADVERTIR), `allow`. Sin privilegios para
  `crmwsp_app`; se lee con `business_category_list()` (taxonomía pública para el formulario de alta) y
  se edita solo con `platform_business_category_upsert` (auditada en `platform_audit_events`).
- **Decisión en `@crmwsp/domain` (`policies/categories`) repetida en SQL** (`tenant_set_business_category`):
  `block` rechaza con mensaje claro (el alta se rechaza **antes** de crear el tenant); `review` deja
  `category_review_status = 'pending'`; `warn` muestra la guía; `allow` no hace nada.
- **Columnas en `tenants`** (`business_category`, `business_category_detail`, `category_review_status`,
  `category_review_reason`, `business_category_set_at`). Un trigger impide que el rol de aplicación las
  cambie directamente: solo las funciones `SECURITY DEFINER` (dueño de la tabla).
- **Mientras está `pending` o `rejected`:** el tenant no puede cambiar su rubro (evita reetiquetarse
  para saltarse la revisión) ni conectar WhatsApp. Se comprueba en la API (403 con mensaje) y, como
  red, un trigger `BEFORE INSERT` en `channel_connections`. Los números ya conectados no se tocan.
- **Cola de revisión en el backoffice** (`/platform/category-reviews`): aprobar, o rechazar con motivo.
  Auditado (`tenant.category_approved|rejected`).
- **Tenants existentes:** rubro `null` → aviso en el panel para que lo indiquen; no se bloquea nada.
- **Nunca se aplica automáticamente** un cambio de regla a tenants existentes: editar una regla solo
  afecta a las declaraciones nuevas. El monitor (T3) solo propone; el admin decide.

## Consecuencias
- El rubro es una declaración del cliente: no detecta mentiras. La revisión manual y el monitoreo de
  calidad son la red.
- Si una regla pasa a `block`, los tenants que ya la tenían siguen activos hasta que un admin actúe.
