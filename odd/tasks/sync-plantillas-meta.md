# sync-plantillas-meta — Meta template sync through BSPs

Branch: feat/sync-plantillas-meta (from feat/integracion). Delivery: local commits, no push.

## Findings (exploration)
- Already on integracion: `WhatsAppProvider.listTemplates` for Gupshup and 360dialog (`name|language` external id, ADR 0014), status mapping, periodic BullMQ worker (every 15 min), `POST /channels/:id/templates/sync`, "Sincronizar con Meta" button, webhook account events (`message_template_status_update`) applied by `apps/worker/src/channel-quality.ts`.
- Gaps closed here: rejection reason was not persisted; two divergent copies of the sync plan (API vs worker); the "approved only outside the 24 h window" rule was scattered as inline checks, not a domain rule.

## Tasks
- [x] T1 Domain: shared `planTemplateSync` (+ rejection reason), `normalizeRejectionReason`, `templateSendIssue`, status-aware `decideDispatch` (RED observed: missing module, then GREEN) - packages/domain/src/templates/sync.ts
- [x] T2 DB migration 0101 `message_templates.rejection_reason` (existing tenant table: RLS unchanged; isolation covered by DB-gated worker test) + contracts DTO field
- [x] T3 Worker/API/webhook: sync (API + worker) and `message_template_status_update` webhook persist the reason; broadcasts, follow-ups and outbound use `templateSendIssue`
- [x] T4 Web: persisted reason on rejected cards, notice for paused/disabled
- [x] T5 Adapter test: 360dialog status mapping (PAUSED/FLAGGED/DISABLED/DELETED); BSP HTTP always mocked
- [x] T6 Fix @crmwsp/knowledge CSV test (CRLF inside quoted cell is normalized to LF in the parser)
- [x] T7 README status updated (live URL https://www.vendemas.chat)

Route: parent inline writer (exploration within budget; edits spread but mechanical).

## Verification
See the commit log of the branch; results are reported in the hand-off (lint, typecheck, test with Postgres 16 + pgvector and Redis in throwaway containers).

## Owner follow-ups
- Gupshup channels need the Partner app id/token (`PUT /channels/:id/partner-credentials`) for sync; 360dialog needs the channel API key only.
- Subscribe the BSP to `message_template_status_update` events in its console so status/reason arrive without waiting for the 15 min tick.
