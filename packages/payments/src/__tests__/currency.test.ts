import { describe, expect, it } from "vitest";
import { formatMinor, fromStripeAmount, toStripeAmount } from "../currency.js";

describe("Stripe amounts", () => {
  it("two-decimal currencies pass through", () => {
    expect(toStripeAmount(78000, "EUR")).toBe(78000);
    expect(toStripeAmount(1999, "usd")).toBe(1999);
  });
  it("zero-decimal currencies pass through (CLP, JPY)", () => {
    expect(toStripeAmount(15000, "CLP")).toBe(15000);
    expect(toStripeAmount(980, "JPY")).toBe(980);
    expect(fromStripeAmount(980, "JPY")).toBe(980);
  });
  it("ISK/UGX are two-decimal for Stripe, zero-decimal in ISO", () => {
    expect(toStripeAmount(5000, "ISK")).toBe(500000);
    expect(fromStripeAmount(500000, "ISK")).toBe(5000);
  });
  it("MGA is zero-decimal for Stripe but 2-decimal in ISO", () => {
    expect(toStripeAmount(10000, "MGA")).toBe(100);
    expect(() => toStripeAmount(10050, "MGA")).toThrow();
    expect(fromStripeAmount(100, "MGA")).toBe(10000);
  });
  it("three-decimal currencies must end in 0", () => {
    expect(toStripeAmount(12340, "KWD")).toBe(12340);
    expect(() => toStripeAmount(12345, "KWD")).toThrow();
  });
  it("rejects non-positive, fractional and bad codes", () => {
    expect(() => toStripeAmount(0, "EUR")).toThrow();
    expect(() => toStripeAmount(10.5, "EUR")).toThrow();
    expect(() => toStripeAmount(100, "EURO")).toThrow();
  });
  it("formats using ISO exponent", () => {
    expect(formatMinor(78000, "EUR")).toContain("780,00");
    expect(formatMinor(15000, "CLP")).toContain("15.000");
  });
});
