import { describe, expect, it } from "vitest";
import {
  REFERRAL_MAX_CREDITS_PER_CHARGE,
  couponIneligibility,
  decideSettlement,
  discountCents,
  expectedChargePrice,
  normalizeCouponCode,
  quoteCharge,
  referralCreditsToUse,
  type CouponDefinition,
  type LocalCharge,
} from "../index.js";

const now = new Date("2026-10-24T12:00:00Z");
const base: CouponDefinition = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "PROMO20",
  type: "percent",
  value: 20,
  plans: [],
  period: "any",
  maxRedemptions: null,
  perTenantLimit: 1,
  validFrom: null,
  validUntil: null,
  active: true,
};
const free = { totalUsed: 0, tenantUsed: 0 };

describe("normalizeCouponCode", () => {
  it("upper-cases, trims and validates", () => {
    expect(normalizeCouponCode("  promo-20 ")).toBe("PROMO-20");
    expect(normalizeCouponCode("ab")).toBeNull();
    expect(normalizeCouponCode("bad code")).toBeNull();
    expect(normalizeCouponCode("x".repeat(33))).toBeNull();
  });
});

describe("discountCents", () => {
  it("percent rounds half-up to the cent", () => {
    expect(discountCents(4900, "percent", 20)).toBe(980);
    expect(discountCents(4900, "percent", 15)).toBe(735);
    expect(discountCents(8900, "percent", 33)).toBe(2937); // 2937.0
    expect(discountCents(999, "percent", 50)).toBe(500); // 499.5 -> 500
    expect(discountCents(4900, "percent", 100)).toBe(4900);
  });
  it("fixed is capped at the list price; free_days never discounts", () => {
    expect(discountCents(4900, "fixed_usd", 10)).toBe(1000);
    expect(discountCents(4900, "fixed_usd", 10.5)).toBe(1050);
    expect(discountCents(4900, "fixed_usd", 100)).toBe(4900);
    expect(discountCents(4900, "free_days", 30)).toBe(0);
  });
  it("rejects invalid values", () => {
    expect(() => discountCents(4900, "percent", 0)).toThrow(RangeError);
    expect(() => discountCents(4900, "percent", 101)).toThrow(RangeError);
    expect(() => discountCents(4900, "fixed_usd", -1)).toThrow(RangeError);
  });
});

describe("couponIneligibility", () => {
  it("accepts a valid coupon", () => {
    expect(couponIneligibility(base, free, "start", "monthly", now)).toBeNull();
  });
  it("checks active, window, plan, period and limits", () => {
    expect(couponIneligibility({ ...base, active: false }, free, "start", "monthly", now)).toBe("inactive");
    expect(couponIneligibility({ ...base, validFrom: new Date("2026-11-01T00:00:00Z") }, free, "start", "monthly", now)).toBe("not_started");
    expect(couponIneligibility({ ...base, validUntil: new Date("2026-10-01T00:00:00Z") }, free, "start", "monthly", now)).toBe("expired");
    expect(couponIneligibility({ ...base, plans: ["pro"] }, free, "start", "monthly", now)).toBe("plan_not_applicable");
    expect(couponIneligibility({ ...base, period: "annual" }, free, "start", "monthly", now)).toBe("period_not_applicable");
    expect(couponIneligibility({ ...base, maxRedemptions: 3 }, { totalUsed: 3, tenantUsed: 0 }, "start", "monthly", now)).toBe("exhausted");
    expect(couponIneligibility(base, { totalUsed: 1, tenantUsed: 1 }, "start", "monthly", now)).toBe("tenant_limit");
  });
  it("free_days coupons ignore the billing period", () => {
    expect(couponIneligibility({ ...base, type: "free_days", value: 15, period: "annual" }, free, "start", null, now)).toBeNull();
  });
});

describe("quoteCharge", () => {
  it("applies a percent coupon to the plan price for the period", () => {
    expect(quoteCharge("start", "monthly", { type: "percent", value: 20 })).toEqual({
      listPrice: "49.00",
      discount: "9.80",
      finalPrice: "39.20",
      freeDays: 0,
      free: false,
    });
    expect(quoteCharge("pro", "annual", { type: "fixed_usd", value: 90 })).toMatchObject({ listPrice: "890.00", discount: "90.00", finalPrice: "800.00" });
  });
  it("100% or more is a free period", () => {
    expect(quoteCharge("start", "monthly", { type: "percent", value: 100 })).toMatchObject({ finalPrice: "0.00", free: true });
    expect(quoteCharge("start", "monthly", { type: "fixed_usd", value: 500 })).toMatchObject({ discount: "49.00", free: true });
  });
  it("free_days grants days without a price", () => {
    expect(quoteCharge("start", "monthly", { type: "free_days", value: 15 })).toEqual({
      listPrice: "49.00",
      discount: "0.00",
      finalPrice: "0.00",
      freeDays: 15,
      free: true,
    });
  });
  it("referral credits: 20% each, monthly only", () => {
    expect(quoteCharge("start", "monthly", null, 2)).toMatchObject({ discount: "19.60", finalPrice: "29.40" });
    expect(quoteCharge("start", "monthly", null, 5)).toMatchObject({ finalPrice: "0.00", free: true });
    expect(quoteCharge("start", "annual", null, 2)).toMatchObject({ discount: "0.00", finalPrice: "490.00" });
  });
});

describe("referralCreditsToUse", () => {
  it("caps stacking at 100% (5 credits) per charge", () => {
    expect(REFERRAL_MAX_CREDITS_PER_CHARGE).toBe(5);
    expect(referralCreditsToUse(0)).toBe(0);
    expect(referralCreditsToUse(3)).toBe(3);
    expect(referralCreditsToUse(9)).toBe(5);
  });
});

describe("expectedChargePrice", () => {
  it("is list price minus a valid discount", () => {
    expect(expectedChargePrice("start", "monthly", "9.80")).toBe("39.20");
    expect(expectedChargePrice("start", "monthly", "0")).toBe("49.00");
    expect(expectedChargePrice("start", "monthly", "49.01")).toBeNull();
    expect(expectedChargePrice("start", "monthly", "-1")).toBeNull();
    expect(expectedChargePrice("start", "monthly", "1.005")).toBeNull();
  });
});

describe("decideSettlement with a discount (settlement invariant)", () => {
  const charge: LocalCharge = {
    id: "c1",
    status: "pending",
    providerPaymentId: "1",
    priceAmount: "39.20",
    priceCurrency: "usd",
    payAmount: "39.2",
    plan: "start",
    periodDays: 30,
    discountAmount: "9.80",
  };
  const report = { paymentId: "1", status: "finished", orderId: "c1", priceAmount: "39.2", priceCurrency: "USD", payAmount: "39.2", actuallyPaid: "39.2" };

  it("settles when stored price == list - stored discount", () => {
    expect(decideSettlement(charge, report)).toEqual({ kind: "apply", status: "paid", actuallyPaid: "39.2" });
  });
  it("rejects a stored price that does not match list - discount", () => {
    expect(decideSettlement({ ...charge, discountAmount: "5.00" }, report)).toEqual({ kind: "ignore", reason: "mismatch" });
    expect(decideSettlement({ ...charge, discountAmount: undefined }, report)).toEqual({ kind: "ignore", reason: "mismatch" });
  });
  it("rejects a discount above the list price or a zero-price provider charge", () => {
    expect(decideSettlement({ ...charge, discountAmount: "60.00" }, report)).toEqual({ kind: "ignore", reason: "mismatch" });
    expect(
      decideSettlement({ ...charge, priceAmount: "0", discountAmount: "49.00" }, { ...report, priceAmount: "0" }),
    ).toEqual({ kind: "ignore", reason: "mismatch" });
  });
});
