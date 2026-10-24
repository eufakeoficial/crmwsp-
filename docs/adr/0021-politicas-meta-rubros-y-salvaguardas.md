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

## Decisión — T2: salvaguardas de mensajería
- **Opt-in/opt-out:** se reutiliza `consents` (ya existía: difusiones solo a `granted`, el worker
  revalida al enviar). Se amplían las palabras de baja (`CANCELAR`, `NO QUIERO RECIBIR MÁS`, …; mensaje
  completo, sin mayúsculas/acentos/puntuación). La **primera** baja envía una confirmación única
  (dentro de la ventana de 24 h que abrió el cliente) y no dispara turno de IA; una baja repetida no
  vuelve a confirmar. "CANCELAR" a secas también da de baja el marketing (riesgo asumido: solo afecta
  a difusiones).
- **Linter de plantillas** (`@crmwsp/domain` `lintTemplate`): errores (verticales prohibidas, pedir
  tarjeta/cuenta/contraseña/documento, variables con saltos, al borde o pegadas) bloquean el envío a
  Meta; advertencias (marketing sin baja, lenguaje promocional en utility, acortadores, demasiadas
  variables) solo informan. `POST /channels/templates/lint` y el formulario de plantillas lo usan.
- **Calidad:** los adaptadores leen ahora los campos v3 `phone_number_quality_update`,
  `account_update`, `message_template_status_update` y `message_template_quality_update` (solo campos
  en lista blanca) → job `ingest-account` → `channel_quality_events` (tabla de tenant con RLS),
  columnas de calidad en `channel_connections`, estado de la plantilla, notificación al dueño
  (`channel_quality`) en advertencia/crítico y e-mail a admins de plataforma en crítico
  (`platform_alert_recipients`). Backoffice: `platform_channel_quality_alerts`.
- **Correos de admins solo para el worker:** no hay un rol de BD separado para el worker, así que
  `platform_alert_recipients()` exige `app.worker_scope = 'platform_alerts'` (local a la transacción)
  y ningún `app.tenant_id`/`app.user_id`; si no, falla con `42501`. Toda petición de la API corre en
  `withTenant` y ningún código de la API fija ese scope, así que ninguna ruta de la API puede leer
  esos correos. Un rol `crmwsp_worker` propio queda como mejora futura.
- **Lagunas:** que el BSP reenvíe estos eventos depende de su suscripción: 360dialog reenvía el
  webhook del canal (eventos de WABA pueden llegar solo al webhook de partner: **no verificado**);
  Gupshup v2 `system-event`/`account-event` sigue ignorado (formato no documentado aquí). Meta no
  publica umbrales numéricos ni semáforo del número: la gravedad es nuestra lectura de los eventos.
- **IA acotada:** reglas 9–11 del prompt (`ai-turn/2026-10-24.1`): solo temas del negocio, rechaza uso
  de asistente general, se identifica como asistente automatizado, deriva a humano a pedido y nunca
  pide tarjetas/cuentas/documentos. El código no entrena ni ajusta modelos con conversaciones; la
  retención/entrenamiento del proveedor BYOK depende de su contrato (la API de OpenAI no entrena con
  datos de API por defecto).

## Decisión — T3: monitor diario de políticas
- Job `policy-monitor-tick` una vez al día (`POLICY_MONITOR_DISABLED=1` lo apaga), concurrencia 1,
  User-Agent identificable, `If-None-Match`, timeout 20 s, 2 reintentos con backoff (no reintenta 4xx),
  tope 2 MB por respuesta y 500 000 caracteres guardados. Solo fuentes que un fetch simple devuelve
  (`whatsappbusiness.com/policy`, `llms.txt`, `.md` y páginas de developers.facebook.com); se excluyen
  `facebook.com/legal` y la Commerce Policy (requieren navegador y la nota de robots desaconseja el
  scraping).
- Texto normalizado (sin scripts/estilos/etiquetas/comentarios) → SHA-256 → `policy_snapshots`; si
  cambia, `policy_changes` pendiente con diff de líneas (sin LLM: no hay ruta de LLM de plataforma) y
  e-mail a admins. El admin la marca revisada (auditado) y, si procede, edita la regla de rubro aparte.
  Tablas de plataforma sin privilegios para `crmwsp_app` (migración 0079).
