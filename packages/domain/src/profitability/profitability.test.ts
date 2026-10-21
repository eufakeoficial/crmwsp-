import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHATSAPP_RATES_USD_MICRO,
  allocateEvenly,
  marginMinor,
  microToCents,
  perUnit,
  resolveWhatsappRates,
  roasBp,
  whatsappRateFor,
} from "./index.js";

describe("whatsapp rates", () => {
  it("falls back to defaults for missing or invalid settings", () => {
    expect(resolveWhatsappRates({}).source).toBe("default");
    expect(resolveWhatsappRates({ profitability: { whatsappRatesUsdMicro: { ar: 1, "54": -1 } } }).source).toBe("default");
  });

  it("uses tenant rates and keeps a default", () => {
    const { rates, source } = resolveWhatsappRates({ profitability: { whatsappRatesUsdMicro: { "54": 7, x: 9 } } });
    expect(source).toBe("tenant");
    expect(rates).toEqual({ "54": 7, default: DEFAULT_WHATSAPP_RATES_USD_MICRO["default"] });
  });

  it("matches the longest calling-code prefix", () => {
    const rates = { "1": 1, "1809": 2, "54": 3, default: 9 };
    expect(whatsappRateFor("+18095550000", rates)).toBe(2);
    expect(whatsappRateFor("+12025550000", rates)).toBe(1);
    expect(whatsappRateFor("+5491100000000", rates)).toBe(3);
    expect(whatsappRateFor("+33600000000", rates)).toBe(9);
  });
});

describe("money helpers", () => {
  it("allocates integer shares that sum exactly", () => {
    expect(allocateEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(allocateEvenly(10, 0)).toEqual([]);
    expect(allocateEvenly(2, 3).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("converts micro-cents to cents rounding half up", () => {
    expect(microToCents(1_499_999)).toBe(1);
    expect(microToCents(1_500_000)).toBe(2);
  });

  it("subtracts USD usage costs only from USD margins (no FX)", () => {
    expect(marginMinor({ currency: "USD", revenueMinor: 1000, adSpendMinor: 100, usageCostMinor: 50 })).toBe(850);
    expect(marginMinor({ currency: "EUR", revenueMinor: 1000, adSpendMinor: 100, usageCostMinor: 50 })).toBe(900);
  });

  it("computes roas and per-unit averages", () => {
    expect(roasBp(300, 100)).toBe(30_000);
    expect(roasBp(300, 0)).toBeNull();
    expect(perUnit(10, 4)).toBe(3);
    expect(perUnit(10, 0)).toBeNull();
  });
});
