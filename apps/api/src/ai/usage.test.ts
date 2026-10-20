import { describe, expect, it } from "vitest";
import { currencyDecimals, spendByKind, usdMicrocentsToMinor } from "./usage.js";

describe("usage conversion", () => {
  it("converts USD micro-cents (1e-8 USD) to cents", () => {
    expect(usdMicrocentsToMinor(100_000_000)).toBe(100); // 1 USD
    expect(usdMicrocentsToMinor(1_250_000)).toBe(1); // 0.0125 USD -> 1 cent
    expect(usdMicrocentsToMinor(499_999)).toBe(0);
    expect(usdMicrocentsToMinor(0)).toBe(0);
  });
  it("reads currency decimals", () => {
    expect(currencyDecimals("USD")).toBe(2);
    expect(currencyDecimals("CLP")).toBe(0);
  });
  it("USD: micro-cent part is converted, the rest stays in cents", () => {
    const r = spendByKind("USD", [
      { kind: "llm_tokens", total: 200_000_000 + 30, micro: 200_000_000 },
      { kind: "wa_message", total: 5, micro: 0 },
    ]);
    expect(r.byKind).toEqual([{ kind: "llm_tokens", costMinor: 230 }, { kind: "wa_message", costMinor: 5 }]);
    expect(r.currencyMismatch).toBe(false);
  });
  it("non-USD: no FX, micro-cent usage flags a mismatch", () => {
    expect(spendByKind("EUR", [{ kind: "wa_message", total: 7, micro: 0 }])).toEqual({ byKind: [{ kind: "wa_message", costMinor: 7 }], currencyMismatch: false });
    expect(spendByKind("EUR", [{ kind: "llm_tokens", total: 0, micro: 5_000_000 }]).currencyMismatch).toBe(true);
  });
});
