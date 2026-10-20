import { describe, expect, it } from "vitest";
import { currencyExample, currencyOptions, currencySymbol, defaultCurrency } from "./currency-api";
import { formatMoneyMinor, majorToMinor } from "./format";

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("currency formatting (T28)", () => {
  it("formats PEN, CLP and EUR with their own decimals", () => {
    expect(nbsp(formatMoneyMinor(123450, "PEN"))).toBe("S/ 1,234.50");
    expect(nbsp(formatMoneyMinor(1250, "CLP"))).toMatch(/1\.?250/);
    expect(nbsp(formatMoneyMinor(1250, "CLP"))).not.toContain(",");
    expect(nbsp(formatMoneyMinor(123450, "EUR"))).toMatch(/1\.?234,50 €/);
    expect(majorToMinor("1250", "CLP")).toBe(1250);
    expect(majorToMinor("12,5", "CLP")).toBeUndefined();
  });

  it("shows symbol and example price", () => {
    expect(currencySymbol("PEN")).toBe("S/");
    expect(nbsp(currencyExample("USD"))).toBe("$1,234.50");
    expect(currencySymbol("EUR")).toBe("€");
    expect(nbsp(currencyExample("EUR"))).toMatch(/1\.?234,50 €/);
  });
});

describe("currency options and defaults", () => {
  const settings = { base: "PEN", enabled: ["USD", "PEN"] };
  it("new products default to the base currency", () => {
    expect(defaultCurrency(settings)).toBe("PEN");
    expect(defaultCurrency(undefined)).toBe("EUR");
  });
  it("lists enabled currencies base first and keeps a record's own currency", () => {
    expect(currencyOptions(settings)).toEqual(["PEN", "USD"]);
    expect(currencyOptions(settings, "EUR")).toEqual(["PEN", "USD", "EUR"]);
    expect(currencyOptions(undefined, "CLP")).toEqual(["CLP"]);
  });
});
