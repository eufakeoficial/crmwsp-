# landing-precios-tracking

Objective: public pricing section on the landing + consent-gated tracking (Meta Pixel, PostHog, Meta CAPI).

## Tasks
- [x] T1 Pricing section (Start/Pro, monthly/annual toggle, limits, market table + footnote), #precios + nav already present.
- [x] T2 Consent banner + consent store (localStorage in try/catch).
- [x] T3 Meta Pixel (lazyOnload) + PostHog (dynamic import) behind consent and env vars.
- [x] T4 Meta Conversions API in apps/api on signup (consent flag, shared event_id, hashed email, fire-and-forget).

## Route
Delegated direct (single writer), 2+ non-trivial files.

## Notes
- Plan data mirrored in apps/web (web does not depend on @crmwsp/billing); `pricing.test.ts` guards drift.
- apps/web/next.config.ts CSP extended (outside the listed surface) so trackers can load when env vars are set.
