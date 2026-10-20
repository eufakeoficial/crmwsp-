import { describe, expect, it } from "vitest";
import { actionRequiresReason, availableTenantActions, estimateMrr, isOverdue, isTenantOperational, nextTenantStatus } from "./index.js";

describe("platform tenant lifecycle", () => {
  it("allows only the documented transitions", () => {
    expect(nextTenantStatus("pending_approval", "approve")).toBe("active");
    expect(nextTenantStatus("pending_approval", "reject")).toBe("rejected");
    expect(nextTenantStatus("active", "suspend")).toBe("suspended");
    expect(nextTenantStatus("suspended", "reactivate")).toBe("active");
    expect(nextTenantStatus("rejected", "reactivate")).toBe("active");
    expect(nextTenantStatus("active", "approve")).toBeNull();
    expect(nextTenantStatus("suspended", "suspend")).toBeNull();
    expect(nextTenantStatus("active", "reject")).toBeNull();
  });

  it("lists the actions per status", () => {
    expect(availableTenantActions("pending_approval")).toEqual(["approve", "reject"]);
    expect(availableTenantActions("active")).toEqual(["suspend"]);
    expect(availableTenantActions("suspended")).toEqual(["reactivate"]);
  });

  it("requires a reason to reject or suspend", () => {
    expect(actionRequiresReason("reject")).toBe(true);
    expect(actionRequiresReason("suspend")).toBe(true);
    expect(actionRequiresReason("approve")).toBe(false);
  });

  it("only active (or unknown legacy) tenants are operational", () => {
    expect(isTenantOperational("active")).toBe(true);
    expect(isTenantOperational(undefined)).toBe(true);
    expect(isTenantOperational("pending_approval")).toBe(false);
    expect(isTenantOperational("suspended")).toBe(false);
  });
});

describe("overdue and MRR", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it("is overdue when the paid period ended, or after the grace without payments", () => {
    expect(isOverdue({ status: "active", paidUntil: "2026-10-20", createdAt: now }, now)).toBe(true);
    expect(isOverdue({ status: "active", paidUntil: "2026-10-21", createdAt: now }, now)).toBe(false);
    expect(isOverdue({ status: "active", paidUntil: null, createdAt: new Date("2026-10-10T00:00:00Z") }, now)).toBe(false);
    expect(isOverdue({ status: "active", paidUntil: null, createdAt: new Date("2026-09-01T00:00:00Z") }, now)).toBe(true);
    expect(isOverdue({ status: "suspended", paidUntil: "2020-01-01", createdAt: now }, now)).toBe(false);
  });

  it("estimates MRR from plan counts", () => {
    expect(estimateMrr({ start: 2, pro: 1, legacy: 3 }, (p) => ({ start: 49, pro: 89 })[p])).toBe(187);
  });
});
