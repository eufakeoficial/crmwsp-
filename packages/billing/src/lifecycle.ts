/**
 * Free trial lifecycle of new tenants (ADR 0015, T6). Pure domain, no I/O.
 *
 * setup (max 7 days from signup, until the first WhatsApp channel is active)
 *   -> trial (7 days from that first connection, Start limits)
 *   -> grace (3 days) -> restricted (read-only, never deleted).
 * Paying at any time makes the tenant `active` (subscription rules, ./subscription.ts).
 * Tenants created before the lifecycle existed (`setupEndsAt === null`) are grandfathered.
 */
import type { PlanDefinition } from "./index.js";
import { SUBSCRIPTION_GRACE_DAYS, applySubscriptionAccess, subscriptionAccess, type SubscriptionAccess } from "./subscription.js";

export const SETUP_DAYS = 7;
export const TRIAL_DAYS = 7;
/** AI simulator messages allowed while in setup. */
export const SETUP_AI_MESSAGES = 50;

const DAY_MS = 86_400_000;

/** Stored on `tenant_plans` (migration 0068). All null = grandfathered tenant. */
export interface TrialLifecycle {
  setupEndsAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  /** Set when the first channel's number already used a free trial elsewhere (T7, 0069). */
  trialDeniedAt?: Date | null;
}

/** `payment_required`: no trial (number already used one); restricted-like until paid. */
export type TenantAccess = SubscriptionAccess | "setup" | "trial" | "payment_required";

export function initialLifecycle(signupAt: Date): TrialLifecycle {
  return { setupEndsAt: new Date(signupAt.getTime() + SETUP_DAYS * DAY_MS), trialStartedAt: null, trialEndsAt: null };
}

function inLifecycle(l: TrialLifecycle | null): l is TrialLifecycle & { setupEndsAt: Date } {
  return l !== null && l.setupEndsAt !== null;
}

/**
 * Access of a tenant. A tenant that ever paid follows the subscription rules only; a
 * grandfathered one too (`unbilled` when it never paid).
 */
export function tenantAccess(paidUntil: string | null, lifecycle: TrialLifecycle | null, now: Date): TenantAccess {
  if (paidUntil || !inLifecycle(lifecycle)) return subscriptionAccess(paidUntil, now);
  const t = now.getTime();
  if (lifecycle.trialDeniedAt && !lifecycle.trialStartedAt) return "payment_required";
  if (!lifecycle.trialStartedAt || !lifecycle.trialEndsAt) return t < lifecycle.setupEndsAt.getTime() ? "setup" : "restricted";
  const end = lifecycle.trialEndsAt.getTime();
  if (t < end) return "trial";
  if (t < end + SUBSCRIPTION_GRACE_DAYS * DAY_MS) return "grace";
  return "restricted";
}

/** Trial started by the first active channel; `null` when not eligible (started, expired, grandfathered). */
export function startTrial(lifecycle: TrialLifecycle | null, now: Date): TrialLifecycle | null {
  if (!inLifecycle(lifecycle) || lifecycle.trialStartedAt || lifecycle.trialDeniedAt) return null;
  if (now.getTime() >= lifecycle.setupEndsAt.getTime()) return null;
  return { ...lifecycle, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS) };
}

/**
 * Platform admin extension by `days` (1..90). Counts from max(current end, now) so an expired
 * setup/trial gets `days` real days. A trial can only be extended once started.
 */
export function extendLifecycle(lifecycle: TrialLifecycle, kind: "setup" | "trial", days: number, now: Date): TrialLifecycle {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new RangeError("days must be an integer in 1..90");
  const from = (d: Date | null) => new Date(Math.max(d?.getTime() ?? now.getTime(), now.getTime()) + days * DAY_MS);
  if (kind === "setup") return { ...lifecycle, setupEndsAt: from(lifecycle.setupEndsAt) };
  if (!lifecycle.trialStartedAt) throw new RangeError("trial not started");
  return { ...lifecycle, trialEndsAt: from(lifecycle.trialEndsAt) };
}

export interface TenantAccessOptions {
  /**
   * The tenant's AI runs on its own provider key (BYOK, ADR 0008): the monthly `ai_messages` cap
   * is lifted, because the tenant pays the provider directly. The cap only applies to SaaS credits.
   * Setup and restricted access still win: they block or cap the AI even with BYOK.
   */
  ownAiKey?: boolean;
}

/** Limits under an access state: setup caps the AI simulator; restricted removes everything. */
export function applyTenantAccess(plan: PlanDefinition, access: TenantAccess, opts: TenantAccessOptions = {}): PlanDefinition {
  if (access === "setup") {
    const ai = plan.limits.ai_messages;
    return { ...plan, limits: { ...plan.limits, ai_messages: ai === null ? SETUP_AI_MESSAGES : Math.min(ai, SETUP_AI_MESSAGES) } };
  }
  if (access === "restricted" || access === "payment_required") return applySubscriptionAccess(plan, "restricted");
  if (opts.ownAiKey) return { ...plan, limits: { ...plan.limits, ai_messages: null } };
  return plan;
}

/** Whole days left until `end` (rounded up, never negative). */
export function daysLeft(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}
