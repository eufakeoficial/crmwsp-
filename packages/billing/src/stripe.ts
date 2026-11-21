/**
 * Card billing of the SaaS subscription with Stripe Billing (ADR 0022). Pure domain, no I/O.
 * Stripe renews automatically; every PAID invoice grants one period (30 days monthly, 365 annual)
 * through the same stacking/grace/read-only rules as NOWPayments (ADR 0013/0015). Access never
 * depends on the Stripe subscription status, only on settled periods.
 */
import { getPlan, type PlanId } from "./index.js";
import { billingPeriodDays, periodPriceUsd, type BillingPeriod } from "./subscription.js";

/** Currency of every plan price (the Stripe prices must be created in USD). */
export const STRIPE_BILLING_CURRENCY = "usd";

/** Price ids configured by the owner, one per plan and period. Missing entries are unsupported. */
export type StripePriceMap = Partial<Record<PlanId, Partial<Record<BillingPeriod, string>>>>;

const ENV_KEYS: Array<[PlanId, BillingPeriod, string]> = [
  ["start", "monthly", "STRIPE_PRICE_START_MONTHLY"],
  ["start", "annual", "STRIPE_PRICE_START_ANNUAL"],
  ["pro", "monthly", "STRIPE_PRICE_PRO_MONTHLY"],
  ["pro", "annual", "STRIPE_PRICE_PRO_ANNUAL"],
];

export function stripePriceMapFromEnv(env: Record<string, string | undefined>): StripePriceMap {
  const map: StripePriceMap = {};
  for (const [plan, period, key] of ENV_KEYS) {
    const id = env[key]?.trim();
    if (id) map[plan] = { ...map[plan], [period]: id };
  }
  return map;
}

/** Price id to charge for a plan and period, or null when it is not configured. */
export function stripePriceId(map: StripePriceMap, plan: PlanId, period: BillingPeriod): string | null {
  return map[plan]?.[period] ?? null;
}

/** Inverse lookup: which plan and period a Stripe price id stands for (null = not ours). */
export function resolveStripePrice(priceId: string | null | undefined, map: StripePriceMap): { plan: PlanId; period: BillingPeriod } | null {
  if (!priceId) return null;
  for (const [plan, period] of ENV_KEYS.map(([p, per]) => [p, per] as const)) {
    if (map[plan]?.[period] === priceId) return { plan, period };
  }
  return null;
}

/** Amount (in cents) a paid invoice of this plan and period must have: the plan price, no discounts. */
export function expectedInvoiceMinor(plan: PlanId, period: BillingPeriod): number {
  return Math.round(Number(periodPriceUsd(getPlan(plan), period)) * 100);
}

/** What the worker extracts from an `invoice.paid` object (see packages/payments stripe-billing). */
export interface StripeInvoiceReport {
  invoiceId: string;
  customerId: string;
  subscriptionId: string | null;
  /** Stripe invoice status; only `paid` settles. */
  status: string;
  /** Price id of the first subscription line. */
  priceId: string | null;
  amountPaidMinor: number;
  currency: string;
}

export type StripeInvoiceDecision =
  | { kind: "settle"; plan: PlanId; period: BillingPeriod; periodDays: number; amountMinor: number; currency: string }
  | { kind: "ignore"; reason: "not_paid" | "unknown_price" | "amount_mismatch" | "currency_mismatch" };

/**
 * `paid` requires a paid invoice for one of OUR configured prices, in USD, for exactly the plan
 * price. Anything else (a stray price, a discount, another currency) is never settled and is
 * recorded on the event for manual review.
 */
export function decideStripeInvoice(report: StripeInvoiceReport, map: StripePriceMap): StripeInvoiceDecision {
  if (report.status !== "paid") return { kind: "ignore", reason: "not_paid" };
  const resolved = resolveStripePrice(report.priceId, map);
  if (!resolved) return { kind: "ignore", reason: "unknown_price" };
  if (report.currency.trim().toLowerCase() !== STRIPE_BILLING_CURRENCY) return { kind: "ignore", reason: "currency_mismatch" };
  if (!Number.isInteger(report.amountPaidMinor) || report.amountPaidMinor !== expectedInvoiceMinor(resolved.plan, resolved.period)) {
    return { kind: "ignore", reason: "amount_mismatch" };
  }
  return {
    kind: "settle",
    plan: resolved.plan,
    period: resolved.period,
    periodDays: billingPeriodDays(resolved.period),
    amountMinor: report.amountPaidMinor,
    currency: STRIPE_BILLING_CURRENCY,
  };
}

export const STRIPE_SUBSCRIPTION_STATUSES = ["incomplete", "trialing", "active", "past_due", "unpaid", "canceled", "paused"] as const;
export type StripeSubscriptionStatus = (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];

/** Stripe subscription status to the stored one; `incomplete_expired` is a dead subscription. */
export function mapStripeSubscriptionStatus(raw: string): StripeSubscriptionStatus | null {
  if (raw === "incomplete_expired") return "canceled";
  return (STRIPE_SUBSCRIPTION_STATUSES as readonly string[]).includes(raw) ? (raw as StripeSubscriptionStatus) : null;
}
