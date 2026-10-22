# CRMWSP — Plan de desarrollo

Hitos derivados de `docs/STRATEGY.md` §11, con alcance técnico concreto y criterio de salida verificable. Sin fechas: cada hito termina cuando su criterio se cumple en staging.

## Fase 0 — Fundación del repositorio ✅ (completada 2026-10-19)

**Objetivo:** que cualquier persona clone, levante el entorno y despliegue con CI.

- Monorepo pnpm + Turborepo con `apps/web`, `apps/api`, `apps/worker` y `packages/*` vacíos pero compilando.
- `infra/docker-compose.dev.yml`: PostgreSQL 16 + pgvector, Redis 7, RustFS (S3 local, ver ADR 0005), Mailpit.
- `packages/db`: Drizzle configurado, primera migración con `tenants`, `users`, `memberships`, RLS activada, helper `withTenant(tenantId, fn)`.
- `packages/contracts`: Zod base y tipado de errores.
- GitHub Actions: lint, typecheck, test, migraciones en seco.
- ESLint + Prettier + commitlint (Conventional Commits) + Husky.
- `docs/adr/0001-stack.md`, `0002-multitenancy-rls.md`.

**Salida:** `pnpm dev` levanta web + api + worker; CI en verde; test de aislamiento de tenants pasa.

## Fase 1 — MVP 0: fundamentos operativos ✅ (completada 2026-10-19)

**Objetivo:** mensajes reales entran y salen sin mezclarse ni duplicarse.

- Auth (Auth.js) con registro, creación de tenant y roles.
- `packages/whatsapp`: adaptador BSP (implementación Gupshup Partner API, ver ADR 0004) con verificación de firma del webhook, envío de texto/medios/plantillas, estados de entrega y descarga de medios.
- Tablas `channel_connections`, `contacts`, `conversations`, `messages`, `attachments`, `inbound_events`, `audit_events`.
- Pipeline de ingestión idempotente (flujo 5.1 de arquitectura).
- Inbox en `apps/web`: lista de conversaciones, hilo, envío, asignación, estados, tiempo real por WebSocket.
- Onboarding de número: el tenant pega la API key que le entrega el BSP (o usa el enlace de alta del BSP); el sistema registra el webhook automáticamente.
- Storage de adjuntos con URLs firmadas.

**Salida:** dos tenants con dos números en staging; 1.000 webhooks con duplicados inyectados producen exactamente los mensajes esperados; un usuario del tenant A no puede leer nada del B (test automatizado).

## Fase 2 — MVP 1: IA con control ✅ (completada 2026-10-20)

**Objetivo:** la IA responde solo con fuentes y propone acciones auditables.

- `packages/knowledge`: importación de CSV de productos, PDF y FAQ; chunking, embeddings en pgvector, versionado de fuentes, detección de conflictos de precio entre documentos.
- `packages/ai`: `LLMProvider` para cualquier proveedor compatible con la API de OpenAI (OpenAI, OpenRouter, DeepSeek o personalizado por `baseUrl`; ver ADR 0008), routing modelo barato/potente, BYOK cifrado por tenant, extractor de campos de contacto con confianza, transcripción y embeddings cuando el proveedor los ofrezca.
- Pantalla **Configuración → IA**: guía de dónde comprar la key y cómo crearla, campo de key cifrada, botón *Probar conexión*, elección de modelos y límite de gasto mensual.
- Policy engine con tabla de acciones y tests de casos negativos.
- `ai_actions`, `action_approvals`, `agent_configs`, `usage_ledger`.
- UI: configuración del agente, revisión de acciones pendientes, ficha de contacto con campos "por confirmar", botón de tomar/devolver control a la IA.
- Modo `assist`: la IA redacta, el agente envía.
- Límite de gasto por tenant y alertas.

**Salida:** suite de 50 escenarios (30 normales, 20 adversariales) corre en CI; 0 precios o plazos sin cita; coste por conversación visible en el dashboard.

Leyenda de estado por ítem: ✅ hecho · 🟡 parcial (se indica qué falta) · ⬜ pendiente.

## Fase 3 — MVP 2: oportunidad → presupuesto → seguimiento 🟡

**Objetivo:** un piloto genera y acepta un presupuesto completo desde WhatsApp.

- ✅ `pipelines`, `opportunities`, `tasks`; Kanban y vista de lista.
- ⬜ `bookings`.
- ✅ `products` con versionado; `quotes` y `quote_items`; umbral de aprobación.
- 🟡 Render de PDF: se renderiza en la API, no en el worker, y sin plantilla por tenant.
- ✅ Envío de presupuesto por WhatsApp; aceptación por link firmado. 🟡 Aceptación por confirmación explícita en chat: sin verificar.
- ✅ `consents` y `message_templates`.
- ⬜ Sincronización de plantillas con Meta (en curso).
- ✅ Motor de `follow_ups` con motivo explicable y respeto de ventana de 24 h.
- 🟡 Kit vertical 1 (servicios con presupuesto: climatización/reformas): sembrado incompleto de etapas, campos, plantillas y prompts.
- ✅ Modo dueño por WhatsApp: consultas de solo lectura y creación de tareas con confirmación.

**Salida:** piloto real completa el ciclo lead → presupuesto → aceptado; los seguimientos se envían solo con consentimiento y plantilla cuando aplica.

**Estado (2026-10-23):** código completo salvo `bookings`, sincronización con Meta y los parciales indicados. Salida pendiente de validación con piloto real.

## Fase 3b — Ecommerce (ADR 0009) 🟡

- ✅ Productos con variantes (talla/color), stock por variante sin sobreventa, fotos y enlace de video.
- ✅ Pedidos desde el chat, conversión presupuesto → pedido, estados de envío.
- ✅ Adjuntar y enviar fotos, videos y documentos desde el inbox. 🟡 Enviar ficha de producto: acción incompleta.
- 🟡 La IA cita precio y stock por variante y la acción "enviar ficha de producto" pasa por el policy engine: citas por variante y política de la acción sin cerrar.

**Salida:** un cliente pide por WhatsApp una prenda en talla y color concretos, recibe foto y precio, se crea el pedido, se reserva stock y se cobra con enlace.

**Estado (2026-10-23):** código completo en catálogo, stock, pedidos y medios; ficha de producto y citas por variante parciales. Salida pendiente de validación con número real y cobro real.

## Fase 4 — MVP 3: resultado económico 🟡

**Objetivo:** ingreso verificado, no inferido.

- ✅ `packages/payments`: `PaymentProvider` con Stripe (Payment Links + webhook firmado); `payments.verified_by` obligatorio.
- ✅ Oportunidad → `won` solo por pago verificado o marca manual auditada.
- ✅ Dashboard: presupuestos enviados/aceptados/cobrados, tiempo medio de cierre, coste WA + IA por tenant, margen estimado.
- ✅ Integración Meta Ads (lectura de atribución `ctwa_clid`).
- ⬜ Job de conciliación contra Stripe (en curso).

**Salida:** un cobro real en staging/prod cierra la oportunidad automáticamente; el dashboard cuadra con Stripe.

**Estado (2026-10-23):** código completo salvo la conciliación con Stripe. Salida pendiente de validación con cobro real.

## Fase 4b — Marketing y crecimiento (prioridad tras el cobro) 🟡

Funciones principales que comparten los CRM líderes de ecommerce/marketing (Wati, Manychat, Kommo, Respond.io, SleekFlow):

1. ✅ **Campañas masivas** con plantillas aprobadas por Meta y segmentos (p. ej. compraron en 90 días, etiqueta, etapa), solo a contactos con consentimiento de marketing, con límite de envío y métricas (enviados, leídos, respondidos, ventas atribuidas).
2. 🟡 **Recuperación de carritos/pedidos sin pagar y presupuestos sin respuesta**: recordatorios automáticos con motivo explicable, ventana de 24 h respetada (plantilla si está cerrada). En curso: recuperación de carritos y pedidos sin pagar.
3. ✅ **Atribución de anuncios**: capturar el origen "clic a WhatsApp" (referral/`ctwa_clid` que reenvía el BSP) y ligar anuncio → conversación → pedido cobrado.
4. ⬜ **Instagram DM y Messenger** detrás de la misma interfaz de canal (vía BSP o API oficial de Meta según disponibilidad).
5. ⬜ **Flujos automáticos** sin programar: bienvenida, horario fuera de oficina, preguntas frecuentes, encuestas y captura de datos, con editor visual simple.

**Salida:** una tienda lanza una campaña a un segmento con consentimiento, recupera pedidos sin pagar y ve qué anuncio generó cada venta cobrada.

**Estado (2026-10-23):** campañas y atribución con código completo; recuperación de carritos en curso; Instagram/Messenger y editor de flujos pendientes. Salida pendiente de validación con campaña real.

## Fase 5 — Escala 1: SaaS automático 🟡

- 🟡 Stripe Billing: planes Business/Growth, límites por plan, suspensión segura, bolsa de mensajes y exceso. Falta el cobro de suscripción.
- 🟡 Onboarding self-service completo: incompleto. 🟡 Segundo BSP (360dialog) tras el adaptador: solo existe el valor del enum, sin adaptador.
- ⬜ Observabilidad completa (OTel, Sentry, alertas), runbooks, backups probados, pruebas de carga.
- ⬜ Exportación/borrado RGPD, DPA, retención configurable.
- 🟡 Hardening: tests de RLS sí; faltan pentest básico y rotación de secretos.

**Salida:** un tenant nuevo se activa sin intervención del equipo; SLOs definidos y medidos.

**Estado (2026-10-23):** parcial; sin cobro de suscripción, sin observabilidad ni RGPD. Salida pendiente.

## Fase 6 — Escala 2: vertical 2 y pedidos 🟡

- ✅ Foto/audio/PDF → pedido estructurado con confirmación de ítems dudosos; `orders`. 🟡 Exportación a ERP: incompleta.
- 🟡 Simulador de conversaciones con A/B de prompts y score por versión (F6 completo): A/B incompleto.
- ⬜ Kit vertical 2 (distribución). ⬜ Señales de pérdida explicables (F11).

**Estado (2026-10-23):** extracción a pedido con código completo; exportación ERP y simulador parciales; vertical 2 y señales de pérdida pendientes. Salida pendiente.

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
