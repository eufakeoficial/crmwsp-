import { describe, expect, it } from "vitest";
import { DEFAULT_AD_RECOMMENDATION_THRESHOLDS as T, costPerMinor, metaSpendToMinor, recommendAd, roasBasisPoints, type AdRecommendationInput } from "./recommendations.js";

const base = (over: Partial<AdRecommendationInput> = {}): AdRecommendationInput => ({
  currency: "EUR",
  hasDailySpend: true,
  otherRevenueCurrencies: [],
  period: { spendMinor: 10_000, revenueMinor: 40_000, purchases: 4, conversations: 20 },
  last7: { spendMinor: 3_000, revenueMinor: 12_000, purchases: 1, conversations: 6 },
  last7DaysWithData: 7,
  ...over,
});

describe("metaSpendToMinor", () => {
  it("converts decimal strings exactly per currency exponent", () => {
    expect(metaSpendToMinor("12.34", "EUR")).toBe(1234);
    expect(metaSpendToMinor("12", "EUR")).toBe(1200);
    expect(metaSpendToMinor("12.345", "EUR")).toBe(1235);
    expect(metaSpendToMinor("0.1", "USD")).toBe(10);
    expect(metaSpendToMinor("1500", "JPY")).toBe(1500);
    expect(metaSpendToMinor("1.2345", "KWD")).toBe(1235);
  });
  it("returns 0 for garbage", () => {
    expect(metaSpendToMinor("-3", "EUR")).toBe(0);
    expect(metaSpendToMinor(undefined, "EUR")).toBe(0);
    expect(metaSpendToMinor("abc", "EUR")).toBe(0);
  });
});

describe("cost and ROAS helpers", () => {
  it("cost per unit is null without units", () => {
    expect(costPerMinor(1000, 0)).toBeNull();
    expect(costPerMinor(1000, 3)).toBe(333);
  });
  it("ROAS in basis points", () => {
    expect(roasBasisPoints(30_000, 10_000)).toBe(300);
    expect(roasBasisPoints(1, 0)).toBeNull();
  });
});

describe("recommendAd", () => {
  it("scales when ROAS beats the target in the period and the last 7 stable days", () => {
    const r = recommendAd(base(), T);
    expect(r.action).toBe("scale");
    expect(r.reason).toContain("4.00×");
    expect(r.reason).toContain("3.00×");
    expect(r.reason).toContain("100.00 EUR");
  });

  it("observes a good ROAS without 7 days of data", () => {
    const r = recommendAd(base({ last7DaysWithData: 4 }), T);
    expect(r.action).toBe("observe");
    expect(r.reason).toContain("4 de 7 días");
  });

  it("pauses when spend reaches the threshold with zero purchases", () => {
    const r = recommendAd(base({ period: { spendMinor: 6_000, revenueMinor: 0, purchases: 0, conversations: 2 } }), T);
    expect(r.action).toBe("pause");
    expect(r.reason).toContain("60.00 EUR");
    expect(r.reason).toContain("50.00 EUR");
  });

  it("pauses when ROAS is below break-even for the period and the last 7 days", () => {
    const r = recommendAd(base({ period: { spendMinor: 10_000, revenueMinor: 5_000, purchases: 1, conversations: 20 }, last7: { spendMinor: 3_000, revenueMinor: 1_000, purchases: 0, conversations: 5 } }), T);
    expect(r.action).toBe("pause");
    expect(r.reason).toContain("0.50×");
    expect(r.reason).toContain("1.00×");
  });

  it("does not pause on a bad period when the last 7 days recovered", () => {
    const r = recommendAd(base({ period: { spendMinor: 10_000, revenueMinor: 5_000, purchases: 1, conversations: 20 }, last7: { spendMinor: 1_000, revenueMinor: 2_000, purchases: 1, conversations: 5 } }), T);
    expect(r.action).toBe("observe");
  });

  it("observes with insufficient data", () => {
    const r = recommendAd(base({ period: { spendMinor: 1_000, revenueMinor: 5_000, purchases: 1, conversations: 2 } }), T);
    expect(r.action).toBe("observe");
    expect(r.reason).toContain("Datos insuficientes");
  });

  it("observes without daily synced spend", () => {
    expect(recommendAd(base({ hasDailySpend: false }), T).action).toBe("observe");
  });

  it("never computes ROAS across currencies", () => {
    const r = recommendAd(base({ otherRevenueCurrencies: ["USD"], period: { spendMinor: 10_000, revenueMinor: 0, purchases: 3, conversations: 20 } }), T);
    expect(r.action).toBe("observe");
    expect(r.reason).toContain("no convertimos monedas");
  });

  it("honours custom thresholds", () => {
    expect(recommendAd(base(), { ...T, targetRoasBp: 500 }).action).toBe("observe");
  });
});
