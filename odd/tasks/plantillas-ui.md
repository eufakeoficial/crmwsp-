# plantillas-ui — WhatsApp templates screen (/app/templates)

Objective: owner/admin manage WhatsApp (Meta) templates per channel; others view.
Branch: feat/plantillas-ui (from origin/feat/integracion). Delivery: local commits, no push.

## Findings (API gaps vs. brief)
- No list endpoint and no sync endpoint existed -> add GET /channels/:id/templates and POST /channels/:id/templates/sync.
- Submit contract supports ONLY name/language/category/body/example: no header, footer or buttons -> UI exposes only those.
- No delete/disable endpoint -> no delete in UI.
- message_templates has no rejection-reason column -> reasons are returned by the sync response only (session-level). DB gap.

## Open gaps (follow-up)
- API: submit contract has no header/footer/buttons.
- API: no delete/disable endpoint for templates.
- DB: rejection reason is not persisted (only returned by the sync response).

## Tasks
- [x] T1 API+contracts: list + sync endpoints (tests) - 499241b
- [x] T2 Web pure helpers (name validation, variables, preview) TDD - 62aae79
- [x] T3 Web api client + templates screen + nav entry - 62aae79 (client), 87db12b (screen, nav)
- [x] T4 Create form with preview + policy hint; wire gating + partner dialog fallback - 87db12b

Route: single inline writer; parent exploration (>5 lookups) already done.
