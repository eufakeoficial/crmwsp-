import { describe, expect, it } from "vitest";
import { estimateCost } from "../pricing.js";

describe("estimateCost", () => {
  it("computes micro-cents for a known model", () => {
    // 1M in * $0.25 + 1M out * $2 = $2.25 = 225 cents = 225_000_000 micro-cents
    expect(estimateCost("gpt-5-mini", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toEqual({
      costMinor: 225_000_000,
      currency: "USD",
      known: true,
      verified: false,
    });
  });
  it("rounds up small usages", () => {
    expect(estimateCost("deepseek-chat", { inputTokens: 1, outputTokens: 0 }).costMinor).toBe(28);
  });
  it("matches dated snapshots", () => {
    expect(estimateCost("gpt-5-mini-2025-08-07", { inputTokens: 10, outputTokens: 0 }).known).toBe(true);
  });
  it("flags every current price as unverified (estimate only, never bill)", () => {
    for (const m of ["gpt-5-mini", "text-embedding-3-small", "openai/gpt-5-mini", "deepseek-chat"]) {
      expect(estimateCost(m, { inputTokens: 1 }).verified).toBe(false);
    }
  });
  it("never invents a price for unknown models", () => {
    expect(estimateCost("mystery-model", { inputTokens: 1000, outputTokens: 1000 })).toEqual({ costMinor: 0, currency: "USD", known: false, verified: false });
  });
});
