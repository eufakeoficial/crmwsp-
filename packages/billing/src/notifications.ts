/**
 * Lifecycle and billing email moments (odd/tasks/wire-emails.md). Pure domain, no I/O.
 * The worker evaluates a tenant snapshot on every tick and sends each returned email at most once
 * (the dedupe key is claimed in `email_dispatches` before sending). Every moment has a bounded
 * window so a deploy, an outage or a late tick never mails stale or historic events.
 */
import { tenantAccess, type TrialLifecycle } from "./lifecycle.js";
import { SUBSCRIPTION_GRACE_DAYS } from "./subscription.js";

const DAY_MS = 86_400_000;
/** "Pago por vencer" goes out this many days before the last paid day. */
export const RENEWAL_NOTICE_DAYS = 3;
/** "Prueba por terminar" goes out this many days before the trial ends. */
export const TRIAL_ENDING_NOTICE_DAYS = 2;
/** Past moments (trial started, trial ended, became read-only) are only mailed this long after. */
export const LIFECYCLE_EMAIL_WINDOW_DAYS = 3;

export interface LifecycleEmailSnapshot {
  tenantId: string;
  /** Last paid UTC day (`YYYY-MM-DD`), or null when the tenant never paid. */
  paidUntil: string | null;
  lifecycle: TrialLifecycle | null;
}

export type LifecycleEmail =
  | { template: "prueba-iniciada"; dedupeKey: string; endsAt: Date; days: number }
  | { template: "prueba-por-terminar"; dedupeKey: string; endsAt: Date; daysLeft: number }
  | { template: "prueba-terminada"; dedupeKey: string }
  | { template: "pago-por-vencer"; dedupeKey: string; dueDate: string; daysLeft: number }
  | { template: "cuenta-solo-lectura"; dedupeKey: string; since: Date };

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const recent = (at: number, now: number) => now >= at && now - at < LIFECYCLE_EMAIL_WINDOW_DAYS * DAY_MS;

export function dueLifecycleEmails(s: LifecycleEmailSnapshot, now: Date): LifecycleEmail[] {
  const t = now.getTime();
  const out: LifecycleEmail[] = [];
  if (s.paidUntil) {
    const end = Date.parse(`${s.paidUntil}T00:00:00Z`);
    if (Number.isNaN(end)) return out;
    const daysToEnd = Math.round((end - utcDay(now)) / DAY_MS);
    if (daysToEnd >= 0 && daysToEnd <= RENEWAL_NOTICE_DAYS) {
      out.push({ template: "pago-por-vencer", dedupeKey: `renewal-due:${s.tenantId}:${s.paidUntil}`, dueDate: s.paidUntil, daysLeft: Math.max(1, daysToEnd) });
    }
    // Restricted from the first UTC day after the grace period (subscriptionAccess).
    const since = end + (SUBSCRIPTION_GRACE_DAYS + 1) * DAY_MS;
    if (recent(since, t)) {
      out.push({ template: "cuenta-solo-lectura", dedupeKey: `restricted:${s.tenantId}:${s.paidUntil}`, since: new Date(since) });
    }
    return out;
  }
  const l = s.lifecycle;
  if (!l?.trialStartedAt || !l.trialEndsAt) return out;
  const started = l.trialStartedAt.getTime();
  const ends = l.trialEndsAt.getTime();
  if (recent(started, t) && t < ends) {
    out.push({ template: "prueba-iniciada", dedupeKey: `trial-started:${s.tenantId}`, endsAt: l.trialEndsAt, days: Math.max(1, Math.round((ends - started) / DAY_MS)) });
  }
  if (t < ends && ends - t <= TRIAL_ENDING_NOTICE_DAYS * DAY_MS) {
    out.push({
      template: "prueba-por-terminar",
      dedupeKey: `trial-ending:${s.tenantId}:${l.trialEndsAt.toISOString()}`,
      endsAt: l.trialEndsAt,
      daysLeft: Math.max(1, Math.ceil((ends - t) / DAY_MS)),
    });
  }
  // "Prueba terminada" copy says the account is read-only: sent once grace is over.
  const restrictedAt = ends + SUBSCRIPTION_GRACE_DAYS * DAY_MS;
  if (tenantAccess(null, l, now) === "restricted" && recent(restrictedAt, t)) {
    out.push({ template: "prueba-terminada", dedupeKey: `trial-ended:${s.tenantId}` });
  }
  return out;
}
