# ADR 0001 — Stack y monorepo

**Estado:** aceptado · **Fecha:** 2026-10-19

## Contexto
Producto SaaS multi-tenant con webhooks de alta frecuencia, trabajos asíncronos (IA, seguimientos, PDFs) y una UI en tiempo real. Equipo pequeño al inicio; debe poder crecer sin reescribir.

## Decisión
- TypeScript en todo el repo; monorepo pnpm + Turborepo.
- `apps/web` Next.js; `apps/api` NestJS/Fastify; `apps/worker` BullMQ.
- PostgreSQL + Drizzle + RLS; Redis; pgvector para conocimiento; S3-compatible para archivos.
- Integraciones externas (WhatsApp, pagos, LLM) detrás de interfaces en `packages/*`.

## Alternativas descartadas
- Supabase todo-en-uno: rápido al inicio, pero los workers, la idempotencia de webhooks y el control fino de RLS/colas se vuelven incómodos; preferimos controlar API y workers.
- Microservicios desde el inicio: sobrecarga operativa sin volumen que lo justifique.
- Python para backend: duplicaría tipos y validadores con el frontend.

## Consecuencias
- Tipos y validadores compartidos end-to-end.
- Un solo despliegue de API y uno de workers; se separan por cola cuando haga falta.
