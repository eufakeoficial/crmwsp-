import { describe, expect, it } from "vitest";
import { PLANS, checkLimit, getPlan, isMonthlyLimit, resolveEffectivePlan, summarizeUsage, usagePeriod } from "../index.js";

describe("plans", () => {
  it("match the landing pricing (seats, contacts, numbers, price)", () => {
    expect(PLANS.start).toMatchObject({ priceMonthlyUsd: 49, priceAnnualUsd: 490 });
    expect(PLANS.start.limits).toMatchObject({ seats: 5, contacts: 10_000, whatsapp_numbers: 2, broadcast_sends: 0 });
    expect(PLANS.pro).toMatchObject({ priceMonthlyUsd: 89, priceAnnualUsd: 890 });
    expect(PLANS.pro.limits).toMatchObject({ seats: 15, contacts: 30_000, whatsapp_numbers: 4 });
  });

  it("getPlan falls back to start for unknown ids", () => {
    expect(getPlan("pro").id).toBe("pro");
    expect(getPlan("enterprise").id).toBe("start");
    expect(getPlan(null).id).toBe("start");
  });

  it("classifies monthly limits", () => {
    expect(isMonthlyLimit("ai_messages")).toBe(true);
    expect(isMonthlyLimit("broadcast_sends")).toBe(true);
    expect(isMonthlyLimit("seats")).toBe(false);
  });
});

describe("checkLimit", () => {
  it("allows under the limit and reports remaining", () => {
    expect(checkLimit(PLANS.start, "seats", 3, 1)).toEqual({ allowed: true, limit: 5, used: 3, remaining: 1 });
  });

  it("allows exactly reaching the limit, then rejects", () => {
    expect(checkLimit(PLANS.start, "seats", 4, 1).allowed).toBe(true);
    expect(checkLimit(PLANS.start, "seats", 5, 1)).toEqual({ allowed: false, limit: 5, used: 5, remaining: 0, reason: "limit_reached" });
  });

  it("rejects bulk amounts that overflow", () => {
    expect(checkLimit(PLANS.pro, "broadcast_sends", 29_990, 20)).toMatchObject({ allowed: false, remaining: 10, reason: "limit_reached" });
  });

  it("rejects features not included in the plan", () => {
    expect(checkLimit(PLANS.start, "broadcast_sends", 0, 1)).toMatchObject({ allowed: false, reason: "not_included" });
  });

  it("allows unlimited limits", () => {
    const plan = { ...PLANS.pro, limits: { ...PLANS.pro.limits, ai_messages: null } };
    expect(checkLimit(plan, "ai_messages", 1e9, 5)).toMatchObject({ allowed: true, remaining: null });
  });

  it("rejects invalid amounts", () => {
    expect(() => checkLimit(PLANS.start, "seats", 0, -1)).toThrow(RangeError);
    expect(() => checkLimit(PLANS.start, "seats", 0, 1.5)).toThrow(RangeError);
  });
});

describe("summarizeUsage", () => {
  it("returns every key with percent capped at 100", () => {
    const items = summarizeUsage(PLANS.start, { ai_messages: 3_000, seats: 1 });
    expect(items.find((i) => i.key === "ai_messages")).toEqual({ key: "ai_messages", limit: 2_000, used: 3_000, percent: 100, exceeded: true });
    expect(items.find((i) => i.key === "seats")?.percent).toBe(20);
    expect(items.find((i) => i.key === "broadcast_sends")?.percent).toBeNull();
    expect(items).toHaveLength(5);
  });

  it("flags usage above the limit (e.g. contacts created by inbound messages past the cap)", () => {
    const items = summarizeUsage(PLANS.start, { contacts: 10_000 });
    expect(items.find((i) => i.key === "contacts")?.exceeded).toBe(false);
    const over = summarizeUsage(PLANS.start, { contacts: 10_001 });
    expect(over.find((i) => i.key === "contacts")?.exceeded).toBe(true);
    expect(summarizeUsage({ ...PLANS.start, limits: { ...PLANS.start.limits, contacts: null } }, { contacts: 1e6 }).find((i) => i.key === "contacts")?.exceeded).toBe(false);
  });
});

describe("usagePeriod", () => {
  it("buckets by tenant time zone", () => {
    const at = new Date("2026-11-01T02:00:00Z");
    expect(usagePeriod(at)).toBe("2026-11");
    expect(usagePeriod(at, "America/La_Paz")).toBe("2026-10");
    expect(usagePeriod(at, "Not/AZone")).toBe("2026-11");
  });
});

describe("resolveEffectivePlan", () => {
  it("override raises and lowers caps per key; null means unlimited", () => {
    const p = resolveEffectivePlan("start", { seats: 50, ai_messages: 10, contacts: null });
    expect(p.limits).toMatchObject({ seats: 50, ai_messages: 10, contacts: null, whatsapp_numbers: 2, broadcast_sends: 0 });
    expect(checkLimit(p, "ai_messages", 10, 1).allowed).toBe(false);
    expect(checkLimit(p, "seats", 20, 1).allowed).toBe(true);
  });

  it("null or invalid override keeps the plan defaults", () => {
    expect(resolveEffectivePlan("pro", null).limits).toEqual(PLANS.pro.limits);
    expect(resolveEffectivePlan("pro", { seats: -1, bogus: 3, contacts: 1.5 }).limits).toEqual(PLANS.pro.limits);
    expect(PLANS.start.limits.seats).toBe(5);
  });
});
