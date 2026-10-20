import { describe, expect, it } from "vitest";
import {
  capiRetryDelayMs,
  computeRoas,
  currencyExponent,
  isRetryableCapiStatus,
  leadEventId,
  minorToMajor,
  normalizePhoneForMeta,
  purchaseEventId,
} from "./index.js";

describe("ads rules", () => {
  it("normalizes E.164 phones to Meta's digits-only form", () => {
    expect(normalizePhoneForMeta("+5491155550000")).toBe("5491155550000");
    expect(normalizePhoneForMeta("+34 600-000-001")).toBe("34600000001");
    expect(normalizePhoneForMeta("abc")).toBeUndefined();
    expect(normalizePhoneForMeta("+123")).toBeUndefined();
  });

  it("converts minor units with the currency exponent", () => {
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(minorToMajor(12345, "EUR")).toBe(123.45);
    expect(minorToMajor(500, "JPY")).toBe(500);
    expect(minorToMajor(1234, "KWD")).toBe(1.234);
  });

  it("builds stable dedupe event ids", () => {
    expect(leadEventId("a")).toBe("lead:a");
    expect(purchaseEventId("o")).toBe("purchase:o");
  });

  it("backs off exponentially with a cap and classifies retryable statuses", () => {
    expect(capiRetryDelayMs(1)).toBe(60_000);
    expect(capiRetryDelayMs(3)).toBe(240_000);
    expect(capiRetryDelayMs(30)).toBe(3600_000);
    expect(isRetryableCapiStatus(0)).toBe(true);
    expect(isRetryableCapiStatus(429)).toBe(true);
    expect(isRetryableCapiStatus(503)).toBe(true);
    expect(isRetryableCapiStatus(400)).toBe(false);
  });

  it("computes ROAS per currency without mixing currencies", () => {
    const r = computeRoas(
      [
        { currency: "EUR", amountMinor: 30000 },
        { currency: "USD", amountMinor: 5000 },
      ],
      [{ currency: "EUR", amountMinor: 10000 }],
    );
    expect(r).toEqual([
      { currency: "EUR", revenueMinor: 30000, spendMinor: 10000, roas: 3 },
      { currency: "USD", revenueMinor: 5000, spendMinor: 0, roas: null },
    ]);
    expect(computeRoas([], [{ currency: "EUR", amountMinor: 100 }])).toEqual([{ currency: "EUR", revenueMinor: 0, spendMinor: 100, roas: 0 }]);
  });
});
