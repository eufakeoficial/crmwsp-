/**
 * SaaS subscription charging rules (tenants pay CRMWSP, ADR 0013). Pure domain, no I/O.
 * Provider: NOWPayments one-off crypto invoices; each settled payment grants one period: 30 days
 * (monthly) or 365 days (annual, ADR 0015). There is no provider-side recurring billing: renewing
 * means paying again.
 */
import { expectedChargePrice } from "./coupons.js";
import { type PlanDefinition, type PlanId } from "./index.js";

/** Days granted by a monthly charge. */
export const SUBSCRIPTION_PERIOD_DAYS = 30;
/** Days granted by an annual charge (ADR 0015). */
export const SUBSCRIPTION_ANNUAL_DAYS = 365;

export const BILLING_PERIODS = ["monthly", "annual"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export function billingPeriodDays(period: BillingPeriod): number {
  return period === "annual" ? SUBSCRIPTION_ANNUAL_DAYS : SUBSCRIPTION_PERIOD_DAYS;
}

/** Inverse of {@link billingPeriodDays}; `null` for any other length (never settled). */
export function billingPeriodFromDays(days: number): BillingPeriod | null {
  if (days === SUBSCRIPTION_PERIOD_DAYS) return "monthly";
  if (days === SUBSCRIPTION_ANNUAL_DAYS) return "annual";
  return null;
}
/** Days after the paid period ends before the tenant is restricted (never deleted). */
export const SUBSCRIPTION_GRACE_DAYS = 3;

export const CHARGE_STATUSES = ["pending", "paid", "failed", "expired", "refunded"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** Terminal states: never overwritten by a later (possibly replayed or reordered) notification. */
export function isTerminalChargeStatus(s: ChargeStatus): boolean {
  return s === "paid" || s === "refunded";
}

const DECIMAL_RE = /^(\d{1,30})(?:\.(\d{1,30}))?$/;

/** Canonical non-negative decimal string, or `null` when the value is missing or malformed. */
export function parseDecimal(value: unknown): string | null {
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    s = String(value);
  } else if (typeof value === "string") {
    s = value.trim();
  } else {
    return null;
  }
  const m = DECIMAL_RE.exec(s);
  if (!m) return null; // also rejects exponents ("1e-7"), signs and empty strings
  const int = (m[1] ?? "0").replace(/^0+(?=\d)/, "");
  const frac = (m[2] ?? "").replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Exact decimal comparison (no floats). Throws on malformed input: callers parse first. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pa === null || pb === null) throw new RangeError("invalid decimal");
  const [ia = "0", fa = ""] = pa.split(".");
  const [ib = "0", fb = ""] = pb.split(".");
  if (ia.length !== ib.length) return ia.length < ib.length ? -1 : 1;
  if (ia !== ib) return ia < ib ? -1 : 1;
  const len = Math.max(fa.length, fb.length);
  const xa = fa.padEnd(len, "0");
  const xb = fb.padEnd(len, "0");
  if (xa === xb) return 0;
  return xa < xb ? -1 : 1;
}

/** Paid in full only when both amounts are valid decimals and `actuallyPaid >= payAmount`. */
export function isFullyPaid(actuallyPaid: unknown, payAmount: unknown): boolean {
  const a = parseDecimal(actuallyPaid);
  const p = parseDecimal(payAmount);
  if (a === null || p === null) return false;
  if (compareDecimal(p, "0") <= 0) return false;
  return compareDecimal(a, p) >= 0;
}

/** NOWPayments `payment_status` → our charge status, before the full-payment check. */
export function mapNowPaymentsStatus(status: string): ChargeStatus | "settle_candidate" {
  switch (status.trim().toLowerCase()) {
    case "finished":
    case "confirmed":
      return "settle_candidate";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    case "refunded":
      return "refunded";
    // waiting, confirming, sending, partially_paid and anything unknown: keep waiting.
    default:
      return "pending";
  }
}

/** Snapshot of a payment as reported by NOWPayments (IPN body or GET /payment/{id}). */
export interface ProviderPaymentReport {
  paymentId: string;
  status: string;
  orderId: string | null;
  priceAmount: unknown;
  priceCurrency: string | null;
  payAmount: unknown;
  actuallyPaid: unknown;
}

/** What we created locally for this payment. */
export interface LocalCharge {
  id: string;
  status: ChargeStatus;
  providerPaymentId: string | null;
  priceAmount: string;
  priceCurrency: string;
  payAmount: string | null;
  plan: PlanId;
  /** Days the charge grants (`subscription_charges.period_days`): 30 or 365. */
  periodDays: number;
  /** Discount stored at creation (`subscription_charges.discount_amount`, ADR 0017); missing = 0. */
  discountAmount?: string | null | undefined;
}

export type SettlementDecision =
  | { kind: "apply"; status: ChargeStatus; actuallyPaid: string | null }
  | { kind: "ignore"; reason: "terminal" | "mismatch" };

/**
 * Decides what a provider report does to a local charge. `paid` requires a finished/confirmed
 * status AND `actually_paid >= pay_amount`, matching order id, price currency
 * (case-insensitive) and exact price amount. The stored price must also be the exact price of
 * the charge's plan for its period (49/89 monthly, 490/890 annual) minus its stored discount, so a charge can never grant
 * 365 days for a monthly price. Paid/refunded charges only move paid → refunded.
 */
export function decideSettlement(charge: LocalCharge, report: ProviderPaymentReport): SettlementDecision {
  if (report.orderId !== charge.id) return { kind: "ignore", reason: "mismatch" };
  const period = billingPeriodFromDays(charge.periodDays);
  const stored = parseDecimal(charge.priceAmount);
  // Invariant (ADR 0017): stored price == plan price for the period - stored discount, and > 0
  // (zero-price periods are coupon grants and never go through a provider).
  const expected = period === null ? null : expectedChargePrice(charge.plan, period, charge.discountAmount ?? "0");
  if (expected === null || stored === null || compareDecimal(stored, "0") <= 0 || compareDecimal(stored, expected) !== 0) {
    return { kind: "ignore", reason: "mismatch" };
  }
  if (charge.providerPaymentId !== null && charge.providerPaymentId !== report.paymentId) return { kind: "ignore", reason: "mismatch" };
  const reportedPrice = parseDecimal(report.priceAmount);
  if (
    reportedPrice === null ||
    compareDecimal(reportedPrice, charge.priceAmount) !== 0 ||
    (report.priceCurrency ?? "").trim().toLowerCase() !== charge.priceCurrency.trim().toLowerCase()
  ) {
    return { kind: "ignore", reason: "mismatch" };
  }
  const mapped = mapNowPaymentsStatus(report.status);
  const actuallyPaid = parseDecimal(report.actuallyPaid);
  // The amount to cover is the one we stored at creation; fall back to the report only if missing.
  const payAmount = charge.payAmount ?? report.payAmount;
  const target: ChargeStatus = mapped === "settle_candidate" ? (isFullyPaid(actuallyPaid, payAmount) ? "paid" : "pending") : mapped;

  if (charge.status === "refunded") return { kind: "ignore", reason: "terminal" };
  if (charge.status === "paid") {
    return target === "refunded" ? { kind: "apply", status: "refunded", actuallyPaid } : { kind: "ignore", reason: "terminal" };
  }
  return { kind: "apply", status: target, actuallyPaid };
}

const DAY_MS = 86_400_000;

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** `YYYY-MM-DD` (UTC). */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Period granted by one settled payment: starts at max(today, current paid end) and lasts
 * `days` (30 monthly, 365 annual), so paying early stacks instead of losing days.
 * Dates are UTC calendar days (`YYYY-MM-DD`); same rule as `subscription_charge_apply` (0067).
 */
export function nextPeriod(currentPaidUntil: string | null, now: Date, days = SUBSCRIPTION_PERIOD_DAYS): { start: string; end: string } {
  const today = utcDay(now);
  const current = currentPaidUntil ? Date.parse(`${currentPaidUntil}T00:00:00Z`) : Number.NaN;
  const start = Number.isNaN(current) ? today : Math.max(today, current);
  return { start: isoDate(start), end: isoDate(start + days * DAY_MS) };
}

export type SubscriptionAccess = "unbilled" | "active" | "grace" | "restricted";

/**
 * Access state from the last paid day. `null` (never paid through the platform) is `unbilled`:
 * not restricted, so tenants created before subscription charging keep working.
 */
export function subscriptionAccess(paidUntil: string | null, now: Date, graceDays = SUBSCRIPTION_GRACE_DAYS): SubscriptionAccess {
  if (!paidUntil) return "unbilled";
  const end = Date.parse(`${paidUntil}T00:00:00Z`);
  if (Number.isNaN(end)) return "unbilled";
  const today = utcDay(now);
  if (today <= end) return "active";
  if (today <= end + graceDays * DAY_MS) return "grace";
  return "restricted";
}

/**
 * Restricted tenants keep read access to all their data but cannot consume AI, send broadcasts
 * or grow (contacts, seats, numbers): every limit becomes "not included". Nothing is deleted.
 */
export function applySubscriptionAccess(plan: PlanDefinition, access: SubscriptionAccess): PlanDefinition {
  if (access !== "restricted") return plan;
  return {
    ...plan,
    limits: { ai_messages: 0, broadcast_sends: 0, contacts: 0, seats: 0, whatsapp_numbers: 0 },
  };
}

/** Price (major units, 2 decimals) charged for one period of a plan: monthly (30 days) or annual (365). */
export function periodPriceUsd(plan: PlanDefinition, period: BillingPeriod = "monthly"): string {
  return (period === "annual" ? plan.priceAnnualUsd : plan.priceMonthlyUsd).toFixed(2);
}

/** One settled (paid, not refunded) charge period; dates are ISO `YYYY-MM-DD`, end exclusive. */
export interface SettledPeriod {
  plan: PlanId;
  periodStart: string;
  periodEnd: string;
}

/**
 * Plan granted on `date` (ISO day): the plan of the settled period covering it, or null when none
 * does. Each charge grants its plan only for its own [periodStart, periodEnd) window, so a
 * higher-tier charge stacked behind cheaper prepaid periods does not upgrade them (finding F7).
 * Mirrors `subscription_effective_plan_internal` (migration 0065).
 */
export function subscriptionPlanAt(periods: readonly SettledPeriod[], date: string): PlanId | null {
  let found: SettledPeriod | null = null;
  for (const p of periods) {
    if (p.periodStart <= date && date < p.periodEnd && (!found || p.periodStart > found.periodStart)) found = p;
  }
  return found ? found.plan : null;
}
