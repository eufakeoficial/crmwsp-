import { describe, expect, it } from "vitest";
import {
  canConnectWhatsApp,
  canTenantChangeCategory,
  decideBusinessCategory,
  reviewStatusFor,
  type BusinessCategoryRule,
} from "./categories.js";

const rule = (action: BusinessCategoryRule["action"], over: Partial<BusinessCategoryRule> = {}): BusinessCategoryRule => ({
  key: `k_${action}`,
  label: action,
  action,
  guidance: action === "warn" ? "No uses el catálogo para servicios." : null,
  active: true,
  ...over,
});

describe("decideBusinessCategory", () => {
  it("refuses blocked, unknown and inactive categories", () => {
    expect(decideBusinessCategory(rule("block")).outcome).toBe("refused");
    expect(decideBusinessCategory(undefined).outcome).toBe("refused");
    expect(decideBusinessCategory(rule("allow", { active: false })).outcome).toBe("refused");
  });

  it("sends review categories to manual review", () => {
    const d = decideBusinessCategory(rule("review"));
    expect(d.outcome).toBe("pending_review");
  });

  it("accepts warn categories with guidance and allow categories without", () => {
    expect(decideBusinessCategory(rule("warn"))).toEqual({ outcome: "accepted", guidance: "No uses el catálogo para servicios." });
    expect(decideBusinessCategory(rule("allow"))).toEqual({ outcome: "accepted", guidance: null });
  });
});

describe("reviewStatusFor", () => {
  it("is none for non-review categories", () => {
    expect(reviewStatusFor(rule("warn"), { category: null, status: "none" })).toBe("none");
  });
  it("is pending for a new review category", () => {
    expect(reviewStatusFor(rule("review"), { category: null, status: "none" })).toBe("pending");
  });
  it("keeps an approval only for the same category", () => {
    const r = rule("review");
    expect(reviewStatusFor(r, { category: r.key, status: "approved" })).toBe("approved");
    expect(reviewStatusFor(r, { category: "other", status: "approved" })).toBe("pending");
  });
});

describe("gates", () => {
  it("blocks category changes and WhatsApp while pending or rejected", () => {
    expect(canTenantChangeCategory("pending")).toBe(false);
    expect(canTenantChangeCategory("rejected")).toBe(false);
    expect(canTenantChangeCategory("none")).toBe(true);
    expect(canConnectWhatsApp("pending")).toBe(false);
    expect(canConnectWhatsApp("rejected")).toBe(false);
    expect(canConnectWhatsApp("approved")).toBe(true);
    expect(canConnectWhatsApp("none")).toBe(true);
  });
});
