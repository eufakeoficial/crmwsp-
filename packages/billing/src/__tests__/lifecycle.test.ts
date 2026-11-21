import { describe, expect, it } from "vitest";
import {
  PLANS,
  SETUP_AI_MESSAGES,
  applyTenantAccess,
  daysLeft,
  extendLifecycle,
  initialLifecycle,
  startTrial,
  tenantAccess,
  type TrialLifecycle,
} from "../index.js";

const DAY = 86_400_000;
const signup = new Date("2026-11-01T12:00:00Z");
const at = (days: number) => new Date(signup.getTime() + days * DAY);
const fresh: TrialLifecycle = initialLifecycle(signup);

describe("tenant lifecycle (setup -> trial -> grace -> restricted)", () => {
  it("a new tenant starts in setup for 7 days", () => {
    expect(fresh.setupEndsAt?.toISOString()).toBe(at(7).toISOString());
    expect(tenantAccess(null, fresh, at(1))).toBe("setup");
    expect(tenantAccess(null, fresh, at(6.9))).toBe("setup");
  });

  it("setup expires to restricted when no channel was connected", () => {
    expect(tenantAccess(null, fresh, at(7.01))).toBe("restricted");
  });

  it("connecting the first channel during setup starts a 7-day trial", () => {
    const t = startTrial(fresh, at(2));
    expect(t).not.toBeNull();
    expect(t?.trialEndsAt?.toISOString()).toBe(at(9).toISOString());
    expect(tenantAccess(null, t, at(8))).toBe("trial");
  });

  it("does not restart a trial, nor start one after setup expired or for grandfathered tenants", () => {
    const t = startTrial(fresh, at(2))!;
    expect(startTrial(t, at(3))).toBeNull();
    expect(startTrial(fresh, at(8))).toBeNull();
    expect(startTrial(null, at(1))).toBeNull();
    expect(startTrial({ setupEndsAt: null, trialStartedAt: null, trialEndsAt: null }, at(1))).toBeNull();
  });

  it("after the trial: 3 days grace, then restricted", () => {
    const t = startTrial(fresh, at(2))!;
    expect(tenantAccess(null, t, at(10))).toBe("grace");
    expect(tenantAccess(null, t, at(12.5))).toBe("restricted");
  });

  it("paying during setup or trial makes the tenant active", () => {
    const paidUntil = "2026-12-15";
    expect(tenantAccess(paidUntil, fresh, at(1))).toBe("active");
    expect(tenantAccess(paidUntil, startTrial(fresh, at(1)), at(3))).toBe("active");
    // A lapsed trial is unlocked by paying.
    expect(tenantAccess(paidUntil, startTrial(fresh, at(1)), at(30))).toBe("active");
  });

  it("grandfathered tenants (no lifecycle) keep the previous behaviour", () => {
    expect(tenantAccess(null, null, at(100))).toBe("unbilled");
    expect(tenantAccess(null, { setupEndsAt: null, trialStartedAt: null, trialEndsAt: null }, at(100))).toBe("unbilled");
    expect(tenantAccess("2026-01-01", null, at(100))).toBe("restricted");
  });

  it("a platform admin can extend setup or trial by N days", () => {
    const setupLonger = extendLifecycle(fresh, "setup", 5, at(6));
    expect(tenantAccess(null, setupLonger, at(11))).toBe("setup");
    // Extending an expired setup counts from now, so the tenant gets N real days.
    const revived = extendLifecycle(fresh, "setup", 3, at(20));
    expect(tenantAccess(null, revived, at(22))).toBe("setup");
    const t = startTrial(fresh, at(1))!;
    const trialLonger = extendLifecycle(t, "trial", 7, at(5));
    expect(tenantAccess(null, trialLonger, at(14))).toBe("trial");
    expect(() => extendLifecycle(fresh, "trial", 3, at(1))).toThrow(RangeError);
    expect(() => extendLifecycle(fresh, "setup", 0, at(1))).toThrow(RangeError);
  });

  it("setup caps the AI simulator; restricted removes everything; trial keeps Start limits", () => {
    expect(applyTenantAccess(PLANS.start, "setup").limits.ai_messages).toBe(SETUP_AI_MESSAGES);
    expect(applyTenantAccess(PLANS.start, "trial")).toBe(PLANS.start);
    expect(applyTenantAccess(PLANS.pro, "restricted").limits.contacts).toBe(0);
  });

  it("an own (BYOK) AI key lifts the ai_messages cap, but setup and restricted access still block", () => {
    expect(applyTenantAccess(PLANS.start, "trial", { ownAiKey: true }).limits.ai_messages).toBeNull();
    expect(applyTenantAccess(PLANS.pro, "active", { ownAiKey: true }).limits.ai_messages).toBeNull();
    expect(applyTenantAccess(PLANS.start, "unbilled", { ownAiKey: true }).limits.ai_messages).toBeNull();
    expect(applyTenantAccess(PLANS.start, "grace", { ownAiKey: true }).limits.ai_messages).toBeNull();
    // Other limits are untouched.
    expect(applyTenantAccess(PLANS.start, "active", { ownAiKey: true }).limits.contacts).toBe(PLANS.start.limits.contacts);
    // Without an own key (SaaS credits) the plan cap applies.
    expect(applyTenantAccess(PLANS.start, "active", { ownAiKey: false }).limits.ai_messages).toBe(PLANS.start.limits.ai_messages);
    // Setup keeps its simulator cap and restricted access removes the AI even with BYOK.
    expect(applyTenantAccess(PLANS.start, "setup", { ownAiKey: true }).limits.ai_messages).toBe(SETUP_AI_MESSAGES);
    expect(applyTenantAccess(PLANS.pro, "restricted", { ownAiKey: true }).limits.ai_messages).toBe(0);
    expect(applyTenantAccess(PLANS.pro, "payment_required", { ownAiKey: true }).limits.ai_messages).toBe(0);
  });

  it("daysLeft rounds up and never goes negative", () => {
    expect(daysLeft(at(7), at(6.5))).toBe(1);
    expect(daysLeft(at(7), at(1))).toBe(6);
    expect(daysLeft(at(7), at(8))).toBe(0);
  });
});
