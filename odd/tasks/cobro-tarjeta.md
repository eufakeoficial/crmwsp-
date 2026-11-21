# cobro-tarjeta — SaaS subscription card billing with Stripe Billing

Branch: feat/cobro-tarjeta (from feat/sync-plantillas-meta). Delivery: local commits, no push, no deploy.
Decision record: docs/adr/0022-cobro-con-tarjeta-stripe-billing.md. Runbook: docs/runbooks/stripe-billing.md.

## Objective
Card payment with automatic renewal next to NOWPayments crypto. `paid` only by verified webhook, mapped to
the existing plans (Start 49/490, Pro 89/890) and the existing grace/read-only logic. Off cleanly when unset.
MercadoPago is a documented next step (ADR 0022), not implemented.

## Design summary
- Stripe customer per tenant (`subscription_billing_accounts`, RLS, read-only for the app role).
- Verified webhook -> `inbound_events` (provider stripe, dedupe `stripe_billing:<event id>`, tenant resolved from OUR customer row) -> worker job `settle-stripe-billing-event`.
- `invoice.paid` for a configured price at the exact plan price -> `stripe_invoice_settle` (idempotent per invoice) -> charge (provider stripe, verified_by webhook) + `subscription_payments` (method stripe) + plan sync. Renewals stack like crypto periods.
- Subscription events only mirror state (informational); access follows `paid_until`.

## Tasks
- [x] T1 (0df16f1) Migration 0102 (table + RLS + 4 SECURITY DEFINER functions) + Drizzle schema + tenant isolation / write-denied / idempotency DB tests - packages/db/src/__tests__/stripe-billing-isolation.test.ts
- [x] T2 (0df16f1) Contracts (`startCardCheckoutRequestSchema`, `cardBillingSchema`, job name) + domain `packages/billing/src/stripe.ts` (RED observed: missing module, then GREEN)
- [x] T3 (d30b870) Adapter `packages/payments/src/stripe-billing` (customer, Checkout, portal, event normalization; mocked fetch only)
- [x] T4 (d30b870) Worker `settleStripeBillingEvent` + DB-gated tests (paid once, replay ignored, renewal stacking, wrong amount/price/not-paid, foreign customer, reordered events)
- [x] T5 (19154d8) API: `GET /billing/card`, `POST /billing/card/checkout`, `POST /billing/card/portal`, `POST /webhooks/stripe-billing` (raw-body signature) + unit tests
- [x] T6 (96503cf) Web: `CardBillingPanel` on the subscription screen (hidden when disabled), Stripe-only redirect guard + helper tests
- [x] T7 (229a606) ADR 0022 + runbook
- [ ] T8 `.env.example` lines: BLOCKED, the file is access-denied for this session; variables are listed in the runbook and ADR (owner to paste)

Route: single parent inline writer (one coherent change across layers; parent context already held the mapping).

## Verification (observed)
- pnpm lint: 16/16 OK. pnpm typecheck: 16/16 OK.
- pnpm test with throwaway Postgres 16 + pgvector and Redis: all packages pass; API 55 files / 417 tests pass with `--no-file-parallelism`.
- New DB-gated suites ran for real: packages/db stripe-billing-isolation (5), apps/worker stripe-billing (6).

## Owner follow-ups
- Create the Stripe account/prices/webhook/portal (runbook) and set the 6 env vars in API and worker deployments.
- Add the env lines to `.env.example`.
- Refunds/disputes do not revoke periods automatically (ADR 0022, Consecuencias).
