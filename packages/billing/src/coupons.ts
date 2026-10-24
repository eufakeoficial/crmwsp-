/**
 * Coupons and referral credits for SaaS subscription charges (ADR 0017). Pure domain, no I/O.
 * Mirrored by the SQL functions of migrations 0071/0072, which stay authoritative (they re-lock
 * the coupon and recompute the discount); this module drives the price preview and the
 * settlement invariant in {@link expectedChargePrice}.
 *
 * Money is computed in integer cents. Percent discounts round half-up to the cent.
 */
import { getPlan, type PlanId } from "./index.js";
import { periodPriceUsd, type BillingPeriod } from "./subscription.js";

export const COUPON_TYPES = ["percent", "fixed_usd", "free_days"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];
export const COUPON_PERIODS = ["monthly", "annual", "any"] as const;
export type CouponPeriod = (typeof COUPON_PERIODS)[number];

/** Referral reward: one credit = 20% off one monthly charge; stackable up to 100%. */
export const REFERRAL_REWARD_PERCENT = 20;
export const REFERRAL_MAX_CREDITS_PER_CHARGE = 100 / REFERRAL_REWARD_PERCENT;

export interface CouponDefinition {
  id: string;
  code: string;
  type: CouponType;
  /** percent: 1..100; fixed_usd: USD > 0 (2 decimals); free_days: 1..365 days. */
  value: number;
  /** Applicable plans; empty = every plan. */
  plans: readonly PlanId[];
  period: CouponPeriod;
  maxRedemptions: number | null;
  perTenantLimit: number;
  validFrom: Date | null;
  validUntil: Date | null;
  active: boolean;
}

/** Redemptions plus live holds (pending charges using the coupon), global and of this tenant. */
export interface CouponUsage {
  totalUsed: number;
  tenantUsed: number;
}

export type CouponIneligibility =
  | "inactive"
  | "not_started"
  | "expired"
  | "plan_not_applicable"
  | "period_not_applicable"
  | "exhausted"
  | "tenant_limit";

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

/** Codes are case-insensitive: stored and compared upper-case. `null` when malformed. */
export function normalizeCouponCode(raw: string): string | null {
  const c = raw.trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

/**
 * Why `coupon` cannot be used for `plan`/`period` now, or `null` when it can. `period` is null
 * for free_days redemptions (they ignore the billing period).
 */
export function couponIneligibility(
  coupon: CouponDefinition,
  usage: CouponUsage,
  plan: PlanId,
  period: BillingPeriod | null,
  now: Date,
): CouponIneligibility | null {
  if (!coupon.active) return "inactive";
  if (coupon.validFrom && now.getTime() < coupon.validFrom.getTime()) return "not_started";
  if (coupon.validUntil && now.getTime() >= coupon.validUntil.getTime()) return "expired";
  if (coupon.plans.length > 0 && !coupon.plans.includes(plan)) return "plan_not_applicable";
  if (coupon.type !== "free_days" && coupon.period !== "any" && coupon.period !== period) return "period_not_applicable";
  if (coupon.maxRedemptions !== null && usage.totalUsed >= coupon.maxRedemptions) return "exhausted";
  if (usage.tenantUsed >= coupon.perTenantLimit) return "tenant_limit";
  return null;
}

/** Discount in cents on a list price in cents. Throws on an out-of-range value. */
export function discountCents(listCents: number, type: CouponType, value: number): number {
  if (type === "percent") {
    if (!Number.isInteger(value) || value < 1 || value > 100) throw new RangeError("percent must be an integer in 1..100");
    return Math.min(listCents, Math.floor((listCents * value + 50) / 100));
  }
  if (type === "fixed_usd") {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError("fixed_usd must be > 0");
    return Math.min(listCents, Math.round(value * 100));
  }
  if (!Number.isInteger(value) || value < 1 || value > 365) throw new RangeError("free_days must be an integer in 1..365");
  return 0;
}

/** Credits actually consumed by one charge (100% cap). */
export function referralCreditsToUse(available: number): number {
  return Math.max(0, Math.min(Math.floor(available), REFERRAL_MAX_CREDITS_PER_CHARGE));
}

const toCents = (usd: string): number => Math.round(Number(usd) * 100);
const fromCents = (c: number): string => (c / 100).toFixed(2);

export interface ChargeQuote {
  listPrice: string;
  discount: string;
  finalPrice: string;
  /** Days granted without a charge (free_days coupons). */
  freeDays: number;
  /** Nothing to pay: the period (or the free days) is granted directly (verified_by = coupon). */
  free: boolean;
}

/**
 * Server-side price of one period with an optional coupon, or (no coupon) referral credits.
 * Referral credits only apply to monthly charges; they never combine with a coupon.
 */
export function quoteCharge(
  plan: PlanId,
  period: BillingPeriod,
  coupon: Pick<CouponDefinition, "type" | "value"> | null,
  referralCredits = 0,
): ChargeQuote {
  const listPrice = periodPriceUsd(getPlan(plan), period);
  const list = toCents(listPrice);
  if (coupon?.type === "free_days") {
    discountCents(list, "free_days", coupon.value); // validates
    return { listPrice, discount: "0.00", finalPrice: "0.00", freeDays: coupon.value, free: true };
  }
  let discount = 0;
  if (coupon) discount = discountCents(list, coupon.type, coupon.value);
  else if (period === "monthly" && referralCredits > 0) {
    discount = discountCents(list, "percent", referralCreditsToUse(referralCredits) * REFERRAL_REWARD_PERCENT);
  }
  const final = list - discount;
  return { listPrice, discount: fromCents(discount), finalPrice: fromCents(final), freeDays: 0, free: final === 0 };
}

const MONEY_RE = /^\d{1,10}(?:\.\d{1,2})?$/;

/**
 * Settlement invariant (ADR 0017): a provider charge must cost exactly the plan price for its
 * period minus the discount stored on it, and the discount is a non-negative cent amount not
 * above the list price. Returns the expected price (2 decimals) or `null` when the stored
 * discount is invalid.
 */
export function expectedChargePrice(plan: PlanId, period: BillingPeriod, discount: string): string | null {
  const d = discount.trim();
  if (!MONEY_RE.test(d)) return null;
  const list = toCents(periodPriceUsd(getPlan(plan), period));
  const dc = toCents(d);
  if (dc > list) return null;
  return fromCents(list - dc);
}
