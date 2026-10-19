# CRMWSP — Plan de desarrollo

Hitos derivados de `docs/STRATEGY.md` §11, con alcance técnico concreto y criterio de salida verificable. Sin fechas: cada hito termina cuando su criterio se cumple en staging.

## Fase 0 — Fundación del repositorio

**Objetivo:** que cualquier persona clone, levante el entorno y despliegue con CI.

- Monorepo pnpm + Turborepo con `apps/web`, `apps/api`, `apps/worker` y `packages/*` vacíos pero compilando.
- `infra/docker-compose.dev.yml`: PostgreSQL 16 + pgvector, Redis 7, MinIO (S3 local), Mailpit.
- `packages/db`: Drizzle configurado, primera migración con `tenants`, `users`, `memberships`, RLS activada, helper `withTenant(tenantId, fn)`.
- `packages/contracts`: Zod base y tipado de errores.
- GitHub Actions: lint, typecheck, test, migraciones en seco.
- ESLint + Prettier + commitlint (Conventional Commits) + Husky.
- `docs/adr/0001-stack.md`, `0002-multitenancy-rls.md`.

**Salida:** `pnpm dev` levanta web + api + worker; CI en verde; test de aislamiento de tenants pasa.

## Fase 1 — MVP 0: fundamentos operativos

**Objetivo:** mensajes reales entran y salen sin mezclarse ni duplicarse.

- Auth (Auth.js) con registro, creación de tenant y roles.
- `packages/whatsapp`: adaptador BSP (implementación Gupshup Partner API, ver ADR 0004) con verificación de firma del webhook, envío de texto/medios/plantillas, estados de entrega y descarga de medios.
- Tablas `channel_connections`, `contacts`, `conversations`, `messages`, `attachments`, `inbound_events`, `audit_events`.
- Pipeline de ingestión idempotente (flujo 5.1 de arquitectura).
- Inbox en `apps/web`: lista de conversaciones, hilo, envío, asignación, estados, tiempo real por WebSocket.
- Onboarding de número: el tenant pega la API key que le entrega el BSP (o usa el enlace de alta del BSP); el sistema registra el webhook automáticamente.
- Storage de adjuntos con URLs firmadas.

**Salida:** dos tenants con dos números en staging; 1.000 webhooks con duplicados inyectados producen exactamente los mensajes esperados; un usuario del tenant A no puede leer nada del B (test automatizado).

## Fase 2 — MVP 1: IA con control

**Objetivo:** la IA responde solo con fuentes y propone acciones auditables.

- `packages/knowledge`: importación de CSV de productos, PDF y FAQ; chunking, embeddings en pgvector, versionado de fuentes, detección de conflictos de precio entre documentos.
- `packages/ai`: `LLMProvider` sobre OpenAI (Structured Outputs), routing modelo barato/potente, BYOK cifrado por tenant, extractor de campos de contacto con confianza, transcripción con Whisper, embeddings `text-embedding-3-small`.
- Policy engine con tabla de acciones y tests de casos negativos.
- `ai_actions`, `action_approvals`, `agent_configs`, `usage_ledger`.
- UI: configuración del agente, revisión de acciones pendientes, ficha de contacto con campos "por confirmar", botón de tomar/devolver control a la IA.
- Modo `assist`: la IA redacta, el agente envía.
- Límite de gasto por tenant y alertas.

**Salida:** suite de 50 escenarios (30 normales, 20 adversariales) corre en CI; 0 precios o plazos sin cita; coste por conversación visible en el dashboard.

## Fase 3 — MVP 2: oportunidad → presupuesto → seguimiento

**Objetivo:** un piloto genera y acepta un presupuesto completo desde WhatsApp.

- `pipelines`, `opportunities`, `tasks`, `bookings`; Kanban y vista de lista.
- `products` con versionado; `quotes` y `quote_items`; umbral de aprobación; render de PDF (worker) con plantilla por tenant.
- Envío de presupuesto por WhatsApp; aceptación por link firmado o por confirmación explícita en chat.
- `consents` y `message_templates`; sincronización de plantillas con Meta.
- Motor de `follow_ups` con motivo explicable y respeto de ventana de 24 h.
- Kit vertical 1 (servicios con presupuesto: climatización/reformas): etapas, campos, plantillas y prompts sembrados.
- Modo dueño por WhatsApp: consultas de solo lectura y creación de tareas con confirmación.

**Salida:** piloto real completa el ciclo lead → presupuesto → aceptado; los seguimientos se envían solo con consentimiento y plantilla cuando aplica.

## Fase 4 — MVP 3: resultado económico

**Objetivo:** ingreso verificado, no inferido.

- `packages/payments`: `PaymentProvider` con Stripe (Payment Links + webhook firmado); `payments.verified_by` obligatorio.
- Oportunidad → `won` solo por pago verificado o marca manual auditada.
- Dashboard: presupuestos enviados/aceptados/cobrados, tiempo medio de cierre, coste WA + IA por tenant, margen estimado.
- Integración Meta Ads (lectura de atribución `ctwa_clid`) si el piloto lo usa.

**Salida:** un cobro real en staging/prod cierra la oportunidad automáticamente; el dashboard cuadra con Stripe.

## Fase 5 — Escala 1: SaaS automático

- Stripe Billing: planes Business/Growth, límites por plan, suspensión segura, bolsa de mensajes y exceso.
- Onboarding self-service completo; segundo BSP (360dialog) tras el adaptador para tenants de alto volumen y para no depender de uno solo.
- Observabilidad completa (OTel, Sentry, alertas), runbooks, backups probados, pruebas de carga.
- Exportación/borrado RGPD, DPA, retención configurable.
- Hardening: pentest básico, rotación de secretos, revisión de RLS.

**Salida:** un tenant nuevo se activa sin intervención del equipo; SLOs definidos y medidos.

## Fase 6 — Escala 2: vertical 2 y pedidos

- Foto/audio/PDF → pedido estructurado con confirmación de ítems dudosos; `orders`; exportación a ERP.
- Simulador de conversaciones con A/B de prompts y score por versión (F6 completo).
- Kit vertical 2 (distribución) y señales de pérdida explicables (F11).

## Orden de implementación dentro de cada fase

1. Migración + contratos (Zod) + reglas de dominio con tests.
2. Workers y adaptadores.
3. Endpoints de API con guards de tenant y OpenAPI.
4. UI.
5. Documentación y ADR si hubo una decisión no obvia.

## Riesgos técnicos y mitigación

| Riesgo | Mitigación |
|---|---|
| Dependencia del BSP (precios, caídas, cambios de API) | Adaptador desacoplado; segundo BSP en Escala 1; contrato ISV por escrito |
| Calidad del número bajada por Meta | Seguimientos solo con consentimiento y plantillas; alertas de calidad desde el BSP |
| Alucinaciones de precio | Policy engine + citas obligatorias + suite adversarial en CI |
| Coste de IA fuera de control | `usage_ledger` desde Fase 2, límites por tenant, modelo barato por defecto, caché de prompts de OpenAI |
| Fuga entre tenants | RLS + helper obligatorio + test de aislamiento en cada PR |
| Pagos falsificados | Solo webhook/conciliación; comprobantes son pista, nunca prueba |
| Complejidad de monorepo para un equipo pequeño | Turborepo con tareas cacheadas; un único `pnpm dev` |
