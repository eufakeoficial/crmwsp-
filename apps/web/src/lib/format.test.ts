import { describe, expect, it } from "vitest";
import { cn } from "./cn";
import {
  currencyDecimals,
  formatMoney,
  formatMoneyMinor,
  formatRelative,
  majorToMinor,
  minorToInput,
  minorToMajor,
} from "./format";

describe("cn", () => {
  it("resolves tailwind conflicts, last wins", () => {
    expect(cn("px-2 px-4", false, "text-ink")).toBe("px-4 text-ink");
  });
});

describe("format", () => {
  it("formats money with the currency code or symbol", () => {
    expect(formatMoney(1500, "USD")).toMatch(/1\D?500/);
  });
  it("formats relative time", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(formatRelative("2026-01-01T11:55:00Z", now)).toBe("hace 5 min");
    expect(formatRelative("2025-12-30T12:00:00Z", now)).toBe("hace 2 d");
  });
});

describe("money in minor units (currency decimals, never / 100)", () => {
  it("reads the decimals from the currency", () => {
    expect(currencyDecimals("CLP")).toBe(0);
    expect(currencyDecimals("EUR")).toBe(2);
    expect(currencyDecimals("KWD")).toBe(3);
    expect(currencyDecimals("not-a-currency")).toBe(2);
  });
  it("CLP: 1250 minor units are $1.250, not 12,50", () => {
    expect(minorToMajor(1250, "CLP")).toBe(1250);
    const text = formatMoneyMinor(1250, "CLP");
    expect(text).toMatch(/1\D?250/);
    expect(text).not.toMatch(/12[.,]50/);
    expect(text).not.toMatch(/[.,]\d{2}$/);
  });
  it("EUR: 1250 minor units are 12,50", () => {
    expect(minorToMajor(1250, "EUR")).toBe(12.5);
    expect(formatMoneyMinor(1250, "EUR")).toMatch(/12,50/);
    expect(formatMoneyMinor(1250, "EUR")).toContain("€");
  });
  it("formatMoney keeps the three decimals of KWD", () => {
    expect(formatMoney(1.234, "KWD")).toMatch(/1[.,]234/);
  });
  it("parses typed amounts per currency", () => {
    expect(majorToMinor("12,50", "EUR")).toBe(1250);
    expect(majorToMinor("12.5", "EUR")).toBe(1250);
    expect(majorToMinor("1.005", "EUR")).toBeUndefined(); // third decimal is not zero
    expect(majorToMinor("12,500", "EUR")).toBe(1250);
    expect(majorToMinor("1250", "CLP")).toBe(1250);
    expect(majorToMinor("12,5", "CLP")).toBeUndefined();
    expect(majorToMinor("1,234", "KWD")).toBe(1234);
    expect(majorToMinor("", "EUR")).toBeUndefined();
    expect(majorToMinor("-3", "EUR")).toBeUndefined();
  });
  it("round-trips through the input text", () => {
    expect(minorToInput(1250, "EUR")).toBe("12.5");
    expect(minorToInput(1250, "CLP")).toBe("1250");
    expect(majorToMinor(minorToInput(1999, "EUR"), "EUR")).toBe(1999);
  });
});
