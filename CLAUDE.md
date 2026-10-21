# CRMWSP — guía para desarrollo

CRM WhatsApp-first multi-tenant con IA para negocios de servicios con presupuestos. Lee antes de tocar código:

- `docs/ARCHITECTURE.md` — stack, estructura, modelo de datos, flujos.
- `docs/ROADMAP.md` — fase actual y criterio de salida.
- `docs/adr/` — decisiones tomadas; no las reabras sin un ADR nuevo.

## Decisiones fijas
- TypeScript estricto en todo el monorepo (pnpm + Turborepo). Apps: `web` (Next.js), `api` (NestJS/Fastify), `worker` (BullMQ).
- PostgreSQL + Drizzle + RLS. Toda tabla de negocio lleva `tenant_id`. Todo acceso a datos pasa por `withTenant(tenantId, fn)`; nunca consultas sin tenant.
- WhatsApp solo vía BSP (Gupshup principal, 360dialog después) detrás de `WhatsAppProvider`. Nada de Meta Cloud API directo ni librerías no oficiales.
- IA detrás de `LLMProvider`: cualquier proveedor compatible con la API de OpenAI, con key propia del cliente (BYOK) o créditos del SaaS (ADR 0008). OpenAI por defecto. Modelo barato por defecto; Structured Outputs para acciones; toda afirmación de precio/stock/plazo lleva cita a `knowledge_chunks` o se deriva a humano.
- Pagos: `paid` solo con `verified_by = webhook | reconciliation`. Nunca por imagen de comprobante. Única excepción, el marcado manual auditado por owner/admin (ADR 0012).
- Webhooks: primero `inbound_events` con `dedupe_key`, luego worker. Siempre idempotente.
- Secretos (API keys de BSP, claves OpenAI BYOK) cifrados; jamás en logs, respuestas ni commits.

## Orden de trabajo en cada feature
1. Migración + schemas Zod en `packages/contracts` + reglas en `packages/domain` con tests.
2. Workers y adaptadores.
3. Endpoints con guard de tenant y OpenAPI.
4. UI.
5. ADR si hubo decisión no obvia.

## Convenciones
- Conventional Commits en español: `feat: …`, `fix: …`, `docs: …`.
- Código y comentarios en inglés; documentación de producto en español.
- Tests de aislamiento de tenants obligatorios para cualquier tabla nueva.
- No añadir dependencias sin justificar en el PR.

## Comandos (a partir de Fase 0)
- `pnpm dev` — levanta web, api y worker con `infra/docker-compose.dev.yml`.
- `pnpm lint && pnpm typecheck && pnpm test` — lo mismo que corre CI.
- `pnpm db:migrate` / `pnpm db:generate` — migraciones Drizzle.
