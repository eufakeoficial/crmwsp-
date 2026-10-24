# Feature: soporte-tickets

Objective: per-user support tickets (tenant side) answered in real time by platform admins (backoffice).
Branch: feat/soporte-tickets (from feat/integracion). Migration: 0068 (may need renumbering at merge; billing work runs in parallel).

## Scope / constraints
- Tables support_tickets, support_messages (tenant, RLS), support_canned_responses (platform-only, no app privileges).
- Platform access only via SECURITY DEFINER `platform_support_*` functions that re-check platform_admins (ADR 0011).
- Tenant RLS hides internal notes and forbids app-role inserts of platform_admin/internal messages.
- Realtime reuses RealtimeHub (Redis pub/sub + SSE); platform inbox gets a `platform:support:events` channel.
- Do not touch billing files. No OpenAPI generator exists in the repo (nothing to update).

## Tasks
- [ ] T1 contracts + domain rules (TDD) — route: inline
- [ ] T2 migration 0068 + drizzle schema + RLS/isolation tests — route: inline
- [ ] T3 API: tenant /support, platform /platform/support, realtime — route: inline
- [ ] T4 Web: tenant Soporte page + sidebar badge, admin inbox + canned responses — route: inline
- [ ] T5 ADR 0016 — route: inline

Route note: this worker is itself the delegated writer; tasks executed inline.

## Evidence
(filled per task)
