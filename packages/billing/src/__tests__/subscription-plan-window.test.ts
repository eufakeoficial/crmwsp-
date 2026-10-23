import { describe, expect, it } from "vitest";
import { subscriptionPlanAt, type SettledPeriod } from "../subscription.js";

// 11 prepaid Start months, then one Pro month stacked behind them (security finding F7).
const start = new Date("2026-01-01T00:00:00Z");
const day = (n: number) => new Date(start.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const periods: SettledPeriod[] = [
  ...Array.from({ length: 11 }, (_, i) => ({ plan: "start" as const, periodStart: day(i * 30), periodEnd: day(i * 30 + 30) })),
  { plan: "pro", periodStart: day(330), periodEnd: day(360) },
];

describe("subscriptionPlanAt", () => {
  it("grants a stacked Pro charge only inside its own period", () => {
    expect(subscriptionPlanAt(periods, day(0))).toBe("start");
    expect(subscriptionPlanAt(periods, day(329))).toBe("start");
    expect(subscriptionPlanAt(periods, day(330))).toBe("pro");
    expect(subscriptionPlanAt(periods, day(359))).toBe("pro");
  });

  it("returns null when no settled period covers the date (end is exclusive)", () => {
    expect(subscriptionPlanAt(periods, day(360))).toBeNull();
    expect(subscriptionPlanAt([], day(0))).toBeNull();
  });
});
