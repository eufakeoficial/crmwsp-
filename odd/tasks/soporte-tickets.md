# Feature: soporte-tickets

Objective: per-user support tickets (tenant side) answered in real time by platform admins (backoffice).
Branch: feat/soporte-tickets (from feat/integracion). Migration: 0075 (renumbered from 0068 when merged into feat/integracion). ADR: 0016 (same caveat).

## Scope / constraints
- Tables support_tickets, support_messages (tenant, RLS), support_canned_responses (platform-only, no app privileges).
- Platform access only via SECURITY DEFINER `platform_support_*` functions that re-check platform_admins (ADR 0011).
- Tenant RLS hides internal notes and forbids app-role inserts of platform_admin/internal messages.
- Realtime reuses RealtimeHub (Redis pub/sub + SSE); platform inbox gets a `platform:support:events` channel.
- Do not touch billing files. No OpenAPI generator exists in the repo (nothing to update).

## Tasks
- [x] T1 contracts + domain rules (TDD) — route: inline — commit 9f2ca53
- [x] T2 migration 0068 + drizzle schema + RLS/isolation tests — route: inline — commit ec6a66d
- [x] T3 API: tenant /support, platform /platform/support, realtime — route: inline — commit 2be4c5b
- [x] T4 Web: tenant Soporte page + sidebar badge, admin inbox + canned responses — route: inline — commit 2de245c
- [x] T5 ADR 0016 + this document — route: inline

Route note: this worker is itself the delegated writer; tasks executed inline. RDD review not run by the worker (parent owns it).

## Evidence
- Domain RED observed (module missing) then GREEN: 12 tests in packages/domain/src/support.
- pnpm typecheck: 16/16 successful. pnpm lint: 16/16 successful.
- pnpm test (turbo --continue): all packages pass except the known @crmwsp/knowledge parseCsvCatalog quotes test.
- DB/e2e tests (support-isolation 7, support.e2e 7) skipped: no DATABASE_URL and Docker daemon not running.

## Next step
- Run DB + e2e tests against Postgres/Redis (`infra/docker-compose.dev.yml`) before merge; renumber 0068/ADR 0016 if billing lands first.
