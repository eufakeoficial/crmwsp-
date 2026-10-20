import { describe, expect, it } from "vitest";
import { addDays, conversionBp, enumerateDays, resolveRange } from "./range.js";

describe("metrics range helpers", () => {
  it("defaults to the last 30 days ending today", () => {
    expect(resolveRange(undefined, undefined, "2026-03-31")).toEqual({ from: "2026-03-02", to: "2026-03-31" });
  });
  it("keeps explicit bounds", () => {
    expect(resolveRange("2026-01-01", "2026-01-07", "2026-03-31")).toEqual({ from: "2026-01-01", to: "2026-01-07" });
  });
  it("rejects inverted, oversized and impossible ranges", () => {
    expect(() => resolveRange("2026-02-02", "2026-02-01", "2026-03-31")).toThrow();
    expect(() => resolveRange("2024-01-01", "2026-01-01", "2026-03-31")).toThrow();
    expect(() => resolveRange("2026-02-31", "2026-03-01", "2026-03-31")).toThrow();
  });
  it("enumerates days across month and leap boundaries", () => {
    expect(enumerateDays("2028-02-27", "2028-03-01")).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(enumerateDays("2026-01-01", "2026-01-01")).toEqual(["2026-01-01"]);
  });
  it("adds days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("computes conversion in basis points", () => {
    expect(conversionBp(1, 3)).toBe(3333);
    expect(conversionBp(0, 0)).toBeNull();
  });
});
