import { describe, expect, it } from "vitest";
import { barScale, dayRevenue, formatBp, rangeFor } from "./dashboard-utils";

describe("dashboard utils", () => {
  it("builds an inclusive range of N days ending today", () => {
    expect(rangeFor(7, new Date("2026-03-10T15:00:00Z"))).toEqual({ from: "2026-03-04", to: "2026-03-10" });
    expect(rangeFor(1, new Date("2026-03-10T15:00:00Z"))).toEqual({ from: "2026-03-10", to: "2026-03-10" });
  });
  it("scales bars relative to the max", () => {
    expect(barScale([0, 5, 10])).toEqual([0, 0.5, 1]);
    expect(barScale([0, 0])).toEqual([0, 0]);
    expect(barScale([])).toEqual([]);
  });
  it("reads a day's revenue per currency", () => {
    const day = { date: "2026-01-01", newConversations: 0, newLeads: 0, buyers: 0, aiConversations: 0, humanConversations: 0, revenue: [{ currency: "EUR", amountMinor: 500 }] };
    expect(dayRevenue(day, "EUR")).toBe(500);
    expect(dayRevenue(day, "USD")).toBe(0);
  });
  it("formats basis points", () => {
    expect(formatBp(null)).toBe("-");
    expect(formatBp(1250)).toContain("12,5");
  });
});
