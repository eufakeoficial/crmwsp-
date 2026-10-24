# Plan limits and billing gaps

## Objective
Close the gaps found in the read-only billing audit: enforce the `whatsapp_numbers` and `contacts`
limits, re-check seats on invitation accept, support annual NOWPayments charges with settlement
integrity, make the site copy truthful and update stale docs.

## Constraints
- Prices unchanged: Start USD 49 / 490, Pro USD 89 / 890.
- `paid` only with `verified_by = webhook | reconciliation` (ADR 0013).
- Inbound customer messages are never dropped or blocked by a plan limit.
- Branch `feat/integracion`; one commit per task; no push/deploy.

## Checklist
- [x] T1 Enforce `whatsapp_numbers` on Gupshup create, 360dialog connect and re-enabling a disabled channel. Route: inline.
- [x] T2 Enforce `contacts` on CSV import (no manual-create endpoint exists); inbound creation allowed and flagged over limit; seats re-checked on invitation accept. Route: inline.
- [x] T3 Annual billing: `period` monthly|annual on charge creation, `period_days` stored (migration 0067), settlement/restack use it, UI selector. Route: inline.
- [x] T4 FAQ/site copy truthful about no automatic charges; access state + paidUntil in Plan y uso. Route: inline.
- [x] T5 ROADMAP/ARCHITECTURE to NOWPayments, fix billing index comment, ADR 0015. Route: inline.
- [x] T6 Free trial + setup mode (user-approved, added mid-task): setup (7 days, gated features 402 SETUP_REQUIRED) -> trial (7 days on first active channel) -> grace -> restricted; grandfather existing tenants; platform admin extension; banner + Plan y uso state. Route: inline.
- [x] T7 Trial anti-abuse (user-approved, added mid-task): platform-level `trial_claims` (HMAC phone), denied trial -> `payment_required`, disposable-email rejection, signup IP + normalized email signals, "posible multicuenta" flag, admin grant trial, backfill of existing numbers. Route: inline.

## Acceptance
- 402 `PLAN_LIMIT_EXCEEDED` when a new/reactivated channel or a CSV import would exceed the plan.
- Annual charge bills `priceAnnualUsd` and grants 365 days; settlement rejects a price that does not match plan+period.

## Checks
`pnpm typecheck`, `pnpm lint`, `pnpm test` (DB tests need DATABASE_URL).

## Progress / evidence
- T1 9ab2ea7: limit on Gupshup create, 360dialog connect (pre-check before Partner API + in-tx check under advisory lock), PATCH re-enable. Tests: apps/api channels (18 passed).
- T2 7f1dff6: CSV import refuses whole import (402, details requested/remaining); no manual-create endpoint exists; inbound never blocked, `exceeded` flag in usage + UI warning; seats re-checked (amount 0) inside accept/signup transaction. RED observed for `exceeded` in packages/billing.
- T3 a10b021: migration 0067 `period_days` (30/365), `subscription_charge_create(..., p_period_days)`, apply/restack use per-charge length; `decideSettlement` requires stored price == plan price for the period. RED observed (4 failing) before implementation. Billing UI period selector. DB tests updated/added (annual grant, restack, isolation of period_days) - skipped locally (no DATABASE_URL, Docker daemon not running).
- T4 4d1444a: FAQ + landing teaser copy (no permanence/automatic charges, 30/365 days, 3 days grace, read-only, never deleted); access state + paidUntil in Plan y uso.
- T5 3af3031: ROADMAP/ARCHITECTURE SaaS billing -> NOWPayments (Stripe kept only for end-customer payments, which is accurate); billing index comment; ADR 0015.
- T6 fb99c61: pure lifecycle in packages/billing (RED observed); migration 0068 (trigger on tenants, `tenant_trial_start`, `platform_extend_lifecycle`, `tenant_setup_reminders_claim`); `SETUP_REQUIRED` 402; ActivationGuard on quotes/orders/bookings/broadcasts/template submit; setup gating of contacts/seats/broadcasts/outbound in PlanLimitsService; AI simulator capped at 50 in setup; worker restriction lifecycle-aware; day-5 reminder email (mailer already existed); banner + states; platform extend endpoint + UI.
- T7 (this commit): migration 0069 (`trial_claims`, `tenant_signup_signals`, `tenant_trial_start(channel, identities)`, backfill functions, `platform_multiaccount_suspects`, `platform_grant_trial`); `@crmwsp/billing/trial-identity` (server-only subpath, node:crypto); disposable list + email normalization in `@crmwsp/domain`; worker backfill tick.

## Pending / not done
- `.env.example`: `TRIAL_IDENTITY_SECRET=` NOT added - the tool permission rules deny reading/writing `.env*` files in this session. Must be added by hand.
- DB-dependent tests (isolation, 0067/0068/0069 functions) written but not executed: no DATABASE_URL and the Docker daemon was not running.
- API e2e suites that sign up a tenant and then create quotes/orders without a channel will now get SETUP_REQUIRED (see ADR 0015 consequences).
- Engram mirror `odd/plan-limits-and-billing-gaps/tasks`: not written by this worker (no Engram tool loaded); pending for the parent.
