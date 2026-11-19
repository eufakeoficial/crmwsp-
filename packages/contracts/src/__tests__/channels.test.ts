import { describe, expect, it } from "vitest";
import { GUPSHUP_LOW_BALANCE_USD, createGupshupChannelRequestSchema, isLowWalletBalance, updateChannelRequestSchema, walletBalanceSchema } from "../index.js";

describe("createGupshupChannelRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(
      createGupshupChannelRequestSchema.safeParse({ phoneE164: "+34600111222", appName: "Demo", apiKey: "abcdefgh1234" })
        .success,
    ).toBe(true);
  });
  it("rejects bad phone, empty app name and short key", () => {
    expect(createGupshupChannelRequestSchema.safeParse({ phoneE164: "600", appName: "D", apiKey: "abcdefgh" }).success).toBe(false);
    expect(createGupshupChannelRequestSchema.safeParse({ phoneE164: "+34600111222", appName: " ", apiKey: "abcdefgh" }).success).toBe(false);
    expect(createGupshupChannelRequestSchema.safeParse({ phoneE164: "+34600111222", appName: "D", apiKey: "x" }).success).toBe(false);
  });
});

describe("updateChannelRequestSchema", () => {
  it("only allows active or disabled", () => {
    expect(updateChannelRequestSchema.safeParse({ status: "disabled" }).success).toBe(true);
    expect(updateChannelRequestSchema.safeParse({ status: "pending" }).success).toBe(false);
  });
});

describe("wallet balance contract", () => {
  it("warns only for USD under the threshold", () => {
    expect(isLowWalletBalance(1.99, "USD")).toBe(true);
    expect(isLowWalletBalance(1.99, "usd")).toBe(true);
    expect(isLowWalletBalance(2, "USD")).toBe(false);
    expect(isLowWalletBalance(0.5, null)).toBe(false);
    expect(isLowWalletBalance(0.5, "EUR")).toBe(false);
    expect(GUPSHUP_LOW_BALANCE_USD).toBe(2);
  });
  it("parses ok and unavailable results", () => {
    expect(walletBalanceSchema.safeParse({ status: "ok", amount: 3.2, currency: "USD", low: false }).success).toBe(true);
    expect(walletBalanceSchema.safeParse({ status: "unavailable" }).success).toBe(true);
    expect(walletBalanceSchema.safeParse({ status: "ok", amount: "x" }).success).toBe(false);
  });
});
