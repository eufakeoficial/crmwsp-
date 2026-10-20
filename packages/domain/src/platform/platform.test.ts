import { describe, expect, it } from "vitest";
import { actionRequiresReason, availableTenantActions, currentMonthUtc, dayRangeUtc, estimateMrr, isOverdue, isTenantOperational, microCentsToUsd, nextTenantStatus } from "./index.js";

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

  it("converts ledger micro-cents to USD", () => {
    expect(microCentsToUsd("250000000")).toBe(2.5);
    expect(microCentsToUsd(123456789n)).toBe(1.234567);
    expect(microCentsToUsd(0)).toBe(0);
    expect(microCentsToUsd("99.7")).toBe(0);
  });

  it("maps inclusive day filters to half-open UTC instants", () => {
    expect(dayRangeUtc("2026-10-01", "2026-10-31")).toEqual({ from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") });
    expect(dayRangeUtc()).toEqual({ from: null, to: null });
    expect(currentMonthUtc(new Date("2026-10-21T23:00:00Z"))).toBe("2026-10");
  });
});
