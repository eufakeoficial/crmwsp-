import { describe, expect, it } from "vitest";
import { aiUsageWarning, type BillingPlanResponse } from "../index.js";

const usage = (limit: number | null, used: number): BillingPlanResponse["usage"] => [
  { key: "contacts", monthly: false, limit: 10, used: 10, percent: 100, exceeded: false },
  { key: "ai_messages", monthly: true, limit, used, percent: limit ? Math.floor((used / limit) * 100) : null, exceeded: limit !== null && used > limit },
];

describe("aiUsageWarning", () => {
  it("does not warn under 80%", () => {
    expect(aiUsageWarning(usage(1000, 799))).toBeNull();
  });
  it("warns from 80% and reports the figures", () => {
    expect(aiUsageWarning(usage(1000, 800))).toEqual({ used: 800, limit: 1000, percent: 80, exhausted: false });
  });
  it("flags an exhausted cap", () => {
    expect(aiUsageWarning(usage(1000, 1000))).toMatchObject({ percent: 100, exhausted: true });
  });
  it("never warns for unlimited (BYOK) or plans without AI", () => {
    expect(aiUsageWarning(usage(null, 99999))).toBeNull();
    expect(aiUsageWarning(usage(0, 5))).toBeNull();
  });
  it("ignores other limits and a missing ai_messages row", () => {
    expect(aiUsageWarning([{ key: "contacts", monthly: false, limit: 10, used: 10, percent: 100, exceeded: false }])).toBeNull();
  });
});
