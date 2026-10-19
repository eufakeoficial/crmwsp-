# CRMWSP — Arquitectura técnica

Documento de diseño del sistema. Deriva de `docs/STRATEGY.md` (tesis de producto) y lo traduce a decisiones técnicas concretas. Se mantiene vivo: cada ADR relevante se registra en `docs/adr/`.

## 1. Principios de diseño

1. **Multi-tenant estricto.** Todo dato pertenece a un `tenant_id`. El aislamiento se aplica en tres capas: Row Level Security en PostgreSQL, contexto de tenant obligatorio en el repositorio de datos, y tests que intentan cruzar tenants y deben fallar.
2. **Idempotencia en todas las entradas externas.** Webhooks de WhatsApp, pasarela de pago y proveedores de IA se registran primero como evento inmutable (`inbound_events`) con clave de deduplicación; el procesamiento ocurre después, en workers, y puede reintentarse sin duplicar efectos.
3. **La IA propone, el sistema ejecuta bajo reglas.** Ningún modelo escribe directamente en el CRM ni envía mensajes. Devuelve *acciones estructuradas* (JSON validado) que pasan por un motor de políticas: autoejecutable, requiere aprobación humana, o prohibido. Toda afirmación sobre precio, stock o plazo lleva referencia a la fuente (`knowledge_chunk_id` + versión).
4. **Dinero solo por fuentes verificables.** Un pago existe si lo confirma el webhook del PSP o una conciliación autorizada. Nunca por OCR de un comprobante.
5. **Costes medibles por tenant.** Cada mensaje de Meta, cada llamada a modelo y cada operación con coste se anota en `usage_ledger` con el tenant, el motivo y el importe estimado. El dashboard de rentabilidad lee de ahí, no estima.
6. **Modular, no microservicios prematuros.** Un monorepo con paquetes bien delimitados. Un único despliegue de API y uno de workers hasta que el volumen justifique separar más.

## 2. Stack

| Capa | Elección | Motivo |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Compartir tipos y validadores entre web, API y workers |
| Lenguaje | TypeScript estricto en todo el repo | Un solo lenguaje, tipos compartidos end-to-end |
| Frontend | Next.js (App Router) + React + Tailwind + shadcn/ui, PWA | Según estrategia; móvil para el "modo dueño" |
| API | NestJS sobre Fastify | Módulos, DI, guards de tenant, OpenAPI generado, maduro para equipos |
| Workers | BullMQ sobre Redis, mismo código base que la API | Reintentos, timers, colas por prioridad, seguimientos programados |
| Base de datos | PostgreSQL 16 + Drizzle ORM + RLS | SQL explícito, migraciones versionadas, RLS nativo |
| Búsqueda vectorial | pgvector | Evita un servicio más; suficiente para conocimiento por tenant |
| Cache / colas | Redis 7 | BullMQ, rate limiting, locks de conversación |
| Archivos | S3-compatible (Cloudflare R2 o AWS S3), bucket por entorno, prefijo por tenant, URLs firmadas | Privacidad y retención por tenant |
| Auth | Auth.js o Clerk para usuarios; API keys por tenant para integraciones | Evitar construir auth desde cero |
| Pagos SaaS | Stripe Billing | Suscripciones, límites, suspensión segura |
| Pagos del cliente final | Stripe Payment Links / Checkout (primer PSP), interfaz `PaymentProvider` para añadir Redsys/Bizum/MercadoPago | Verificación por webhook firmado |
| WhatsApp | Gupshup (BSP principal) tras adaptador `WhatsAppProvider`. No se usa Meta Cloud API directo: requiere ser Tech Provider verificado por Meta y no disponemos de esa estructura empresarial. El BSP gestiona alta de números, WABA, plantillas y facturación de Meta; nosotros consumimos su API y webhooks. | Adaptador evita acoplarse a un BSP concreto; cambiar de proveedor no toca el dominio |
| IA | OpenAI como único proveedor: interfaz `LLMProvider` con una sola implementación. Routing entre modelo barato (`gpt-4o-mini` o equivalente vigente) para clasificación/extracción y modelo potente solo para turnos complejos. BYOK por tenant (clave OpenAI propia del cliente) o créditos del SaaS con límite. Embeddings `text-embedding-3-small`; audio con Whisper. | Coste bajo y previsible; un solo SDK que mantener |
| Observabilidad | OpenTelemetry → Grafana Cloud o Datadog; Sentry para errores; logs estructurados (pino) | Trazas por conversación e invocación de IA |
| Infra | Docker; despliegue inicial en Railway/Fly.io o Hetzner + Docker Compose; migrar a Kubernetes cuando haga falta | Coste bajo al inicio, sin reescritura después |
| CI/CD | GitHub Actions: lint, typecheck, tests, migraciones en seco, build de imágenes | |

## 3. Estructura del monorepo

```
crmwsp/
├── apps/
│   ├── web/          # Next.js: inbox, pipeline, presupuestos, dashboard, onboarding
│   ├── api/          # NestJS: REST + webhooks + WebSocket (tiempo real del inbox)
│   └── worker/       # Procesos BullMQ: ingestión, IA, seguimientos, facturación
├── packages/
│   ├── db/           # Esquema Drizzle, migraciones, políticas RLS, seeds
│   ├── domain/       # Entidades, reglas de negocio puras, máquinas de estado (sin IO)
│   ├── contracts/    # Zod schemas y tipos compartidos (DTOs, eventos, acciones IA)
│   ├── whatsapp/     # Adaptador WhatsAppProvider: implementación Gupshup; 360dialog en Escala 1, firma de webhooks
│   ├── payments/     # Adaptador PaymentProvider: Stripe y futuros
│   ├── ai/           # LLMProvider, prompts versionados, extractores, policy engine, evaluación
│   ├── knowledge/    # Ingesta de catálogos/FAQ/PDF, chunking, embeddings, versionado
│   ├── billing/      # Usage ledger, límites por plan, integración Stripe Billing
│   └── ui/           # Componentes shadcn compartidos
├── infra/            # Docker Compose dev, Dockerfiles, IaC
├── docs/             # Este documento, ADRs, runbooks
└── .github/workflows/
```

Regla de dependencias: `domain` y `contracts` no importan nada de IO. `api` y `worker` orquestan; los adaptadores (`whatsapp`, `payments`, `ai`) se inyectan por interfaz.

## 4. Modelo de datos

Todas las tablas de negocio llevan `tenant_id uuid NOT NULL` con índice compuesto `(tenant_id, id)` y política RLS `tenant_id = current_setting('app.tenant_id')::uuid`.

### Identidad y organización
- `tenants` — plan, estado, límites, moneda, zona horaria, `settings jsonb`.
- `users` — identidad global (email, auth provider id).
- `memberships` — user × tenant × role (`owner`, `admin`, `agent`, `viewer`).
- `api_keys` — por tenant, hash, scopes, último uso.

### Canal
- `channel_connections` — `provider` (`gupshup`; `360dialog` más adelante), número, identificador de canal del BSP, API key del BSP cifrada (envelope encryption), estado, calidad del número reportada por el BSP.
- `message_templates` — plantillas aprobadas por Meta, categoría, idioma, estado, variables.

### Contactos y conversaciones
- `contacts` — teléfono E.164 único por tenant, nombre, campos extraídos con confianza (`extracted jsonb`: `{field, value, confidence, source_message_id}`), etiquetas.
- `consents` — contacto × tipo (`marketing`, `service`, `follow_up`) × estado × evidencia (mensaje, fecha).
- `conversations` — contacto × canal, `assigned_user_id`, estado (`open`, `pending`, `resolved`), `last_inbound_at` (para la ventana de 24 h), `ai_mode` (`auto`, `assist`, `off`), `lock_version`.
- `messages` — dirección, tipo, cuerpo, `wa_message_id` único, estado de entrega, `author` (`contact`, `user`, `ai`), `ai_action_id` si lo generó la IA.
- `attachments` — storage key, mime, tamaño, transcripción/OCR si procede, retención.

### Ventas
- `pipelines`, `pipeline_stages` — configurables por tenant; kits verticales los siembran.
- `opportunities` — contacto, etapa, valor estimado, `source`, `owner_user_id`, `next_action_at`, `lost_reason`.
- `opportunity_stage_history` — auditoría de cambios de etapa.
- `products` — catálogo con `price_source` (`manual`, `import:<id>`), versión y `valid_from`.
- `quotes`, `quote_items` — estado (`draft`, `pending_approval`, `sent`, `accepted`, `rejected`, `expired`), PDF generado, `approval_id`.
- `orders` — resultado de un quote aceptado; para el vertical de pedidos.
- `payments` — `provider`, `provider_ref`, importe, moneda, estado, **`verified_by` (`webhook`, `reconciliation`) obligatorio para `paid`**, payload firmado.
- `bookings` — visitas/citas ligadas a oportunidad.
- `tasks` — asignado, vencimiento, origen (`manual`, `ai`, `automation`).

### IA y conocimiento
- `knowledge_sources` — tipo (csv, pdf, url, faq), versión, estado de ingesta, hash.
- `knowledge_chunks` — texto, embedding (pgvector), `source_id`, `version`, metadatos.
- `agent_configs` — prompt versionado, modelo, umbrales de confianza, políticas de acción, presupuesto mensual.
- `ai_actions` — acción propuesta (JSON validado contra `contracts`), fuentes citadas, confianza, decisión del policy engine, `approval_id`, resultado.
- `action_approvals` — quién aprobó/rechazó y cuándo.
- `ai_evaluations` — resultados del simulador: escenario, versión de prompt, score, errores detectados.

### Automatización y seguimiento
- `automations` — disparador + condiciones + acciones, versionadas.
- `follow_ups` — oportunidad/conversación, motivo explicable, `scheduled_at`, requiere plantilla sí/no, consentimiento verificado, estado.

### Económico y auditoría
- `usage_ledger` — tenant, tipo (`wa_message`, `llm_tokens`, `storage`, `psp_fee`), cantidad, coste estimado, referencia.
- `subscriptions` — espejo de Stripe, plan, límites, estado.
- `inbound_events` — todo webhook crudo: proveedor, `dedupe_key` único, payload, firma verificada, `processed_at`.
- `audit_events` — actor (user/ai/system), entidad, acción, diff, IP, motivo.
- `execution_logs` — trazas de workers por job.

## 5. Flujos críticos

### 5.1 Mensaje entrante
1. `POST /webhooks/whatsapp/:connectionId` verifica firma HMAC, responde 200 en < 1 s.
2. Inserta en `inbound_events` con `dedupe_key = wa_message_id`; si existe, termina.
3. Encola `ingest-message` (BullMQ, cola `inbound`, prioridad alta).
4. Worker: resuelve tenant y canal; upsert de contacto; abre o recupera conversación bajo lock Redis `conv:<id>`; inserta mensaje; actualiza `last_inbound_at`; publica evento `message.received` (WebSocket al inbox y a automatizaciones).
5. Si hay adjunto de audio: encola `transcribe`. Si imagen/PDF y el vertical lo usa: encola `extract-document`.
6. Si `ai_mode != off`: encola `ai-turn` con el contexto de la conversación.

### 5.2 Turno de IA
1. Carga `agent_config`, historial reciente, ficha de contacto, oportunidad abierta.
2. Retrieval sobre `knowledge_chunks` del tenant (versión activa).
3. Llama a OpenAI (Structured Outputs con JSON Schema) con salida estructurada: `{ reply?, actions[], citations[], confidence, needs_human: boolean, reason }`.
4. Policy engine clasifica cada acción:
   - `auto`: actualizar campo de contacto con confianza ≥ umbral, crear tarea, mover etapa inicial.
   - `approve`: enviar presupuesto > umbral, aplicar descuento, enviar plantilla proactiva, cualquier acción económica.
   - `deny`: afirmar precio sin cita válida, prometer plazo sin fuente.
5. `reply` se envía solo si todas sus afirmaciones tienen citas o es conversacional sin datos; en caso contrario `needs_human = true` y se asigna a un agente.
6. Todo queda en `ai_actions` + `usage_ledger` (tokens de entrada/salida, modelo, coste calculado con la tarifa vigente de OpenAI).

### 5.3 Presupuesto y cobro
1. Oportunidad → `quote` en `draft` con items referenciando `products` (precio copiado + `product_version`).
2. Si total > umbral del tenant o incluye descuento → `pending_approval`; notificación al owner (web + WhatsApp "modo dueño").
3. Aprobado → genera PDF (worker `render-quote`), lo sube a storage, envía por WhatsApp (plantilla si fuera de ventana).
4. Cliente acepta (link o mensaje interpretado + confirmación explícita) → `accepted`; se crea `PaymentProvider.createPaymentLink()`.
5. Webhook del PSP (`inbound_events`, firma verificada) → `payments.status = paid`, `verified_by = webhook` → oportunidad a `won`, tarea de ejecución creada, `follow_ups` de postventa programados.

### 5.4 Seguimiento con consentimiento
Job diario `plan-follow-ups` por tenant: busca quotes `sent` sin respuesta > N días, conversaciones con intención sin cierre, etc. Para cada candidato: comprueba `consents`, comprueba ventana de 24 h (si cerrada, exige `message_template`), genera motivo explicable, crea `follow_up` en estado `suggested`. El tenant elige entre revisión manual o autoenvío para categorías concretas.

## 6. Seguridad y cumplimiento

- API keys del BSP y claves OpenAI BYOK cifradas con envelope encryption (clave maestra en KMS del proveedor cloud); nunca en logs ni en respuestas de API.
- Verificación de firma en todos los webhooks; rechazo con 401 y registro.
- RLS + tests automáticos de aislamiento (`packages/db/test/tenant-isolation.test.ts`).
- Rate limiting por tenant y por API key.
- RGPD: endpoints de exportación y borrado por contacto y por tenant; retención configurable de adjuntos y transcripciones; registro de encargado de tratamiento; región de datos UE por defecto.
- Límite de gasto por tenant: al 80 % alerta, al 100 % se desactiva IA automática y mensajes proactivos (nunca la bandeja).
- Auditoría inmutable de acciones de IA y de usuarios.

## 7. Escalabilidad

- API stateless tras balanceador; WebSocket con adaptador Redis para múltiples réplicas.
- Workers escalan horizontalmente por cola (`inbound`, `ai`, `outbound`, `scheduled`, `billing`); concurrencia por tenant limitada para evitar que un cliente monopolice.
- PostgreSQL: particionado por rango de fecha en `messages`, `inbound_events`, `usage_ledger` cuando superen decenas de millones de filas; réplicas de lectura para dashboards.
- Archivos fuera de la base de datos desde el día uno.
- Límites claros por plan aplicados en `billing` para proteger el coste variable.

## 8. Calidad

- Tests unitarios en `domain` y `ai` (policy engine con casos positivos y negativos: precio inventado, descuento no autorizado, etc.).
- Tests de integración con PostgreSQL y Redis en Docker (webhooks duplicados, aislamiento de tenants, flujo presupuesto→pago).
- Simulador de conversaciones (F6) como suite de evaluación ejecutable en CI contra versiones de prompt; umbral mínimo de score para desplegar.
- Entornos: `dev` (Compose local), `staging` (cuenta WhatsApp de pruebas y Stripe test), `prod`.
