import { describe, expect, it } from "vitest";
import {
  PLANS,
  applySubscriptionAccess,
  compareDecimal,
  decideSettlement,
  isFullyPaid,
  mapNowPaymentsStatus,
  nextPeriod,
  parseDecimal,
  periodPriceUsd,
  subscriptionAccess,
  type LocalCharge,
  type ProviderPaymentReport,
} from "../index.js";

describe("decimals", () => {
  it("parses canonical decimals and rejects junk", () => {
    expect(parseDecimal("010.500")).toBe("10.5");
    expect(parseDecimal(49)).toBe("49");
    expect(parseDecimal("49.00")).toBe("49");
    expect(parseDecimal(1e-7)).toBeNull();
    expect(parseDecimal("-1")).toBeNull();
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
    expect(parseDecimal(Number.NaN)).toBeNull();
  });

  it("compares exactly without floats", () => {
    expect(compareDecimal("0.1", "0.10")).toBe(0);
    expect(compareDecimal("49.000001", "49")).toBe(1);
    expect(compareDecimal("9.99", "10")).toBe(-1);
    expect(compareDecimal("123456789012345678.000000000000000001", "123456789012345678")).toBe(1);
  });
});

describe("isFullyPaid", () => {
  it("requires actually_paid >= pay_amount", () => {
    expect(isFullyPaid("49.5", "49.5")).toBe(true);
    expect(isFullyPaid("49.6", "49.5")).toBe(true);
    expect(isFullyPaid("49.49999999", "49.5")).toBe(false);
  });
  it("missing or malformed amounts are not paid", () => {
    expect(isFullyPaid(undefined, "49.5")).toBe(false);
    expect(isFullyPaid(null, "49.5")).toBe(false);
    expect(isFullyPaid("abc", "49.5")).toBe(false);
    expect(isFullyPaid("49.5", null)).toBe(false);
    expect(isFullyPaid("1", "0")).toBe(false);
  });
});

describe("mapNowPaymentsStatus", () => {
  it.each([
    ["finished", "settle_candidate"],
    ["confirmed", "settle_candidate"],
    ["FINISHED", "settle_candidate"],
    ["partially_paid", "pending"],
    ["waiting", "pending"],
    ["confirming", "pending"],
    ["sending", "pending"],
    ["failed", "failed"],
    ["expired", "expired"],
    ["refunded", "refunded"],
    ["something_new", "pending"],
  ])("%s → %s", (input, out) => {
    expect(mapNowPaymentsStatus(input)).toBe(out);
  });
});

describe("decideSettlement", () => {
  const charge: LocalCharge = {
    id: "00000000-0000-4000-8000-0000000000aa",
    status: "pending",
    providerPaymentId: "5077125051",
    priceAmount: "49.00",
    priceCurrency: "usd",
    payAmount: "49.31",
  };
  const report = (o: Partial<ProviderPaymentReport> = {}): ProviderPaymentReport => ({
    paymentId: "5077125051",
    status: "finished",
    orderId: charge.id,
    priceAmount: 49,
    priceCurrency: "USD",
    payAmount: "49.31",
    actuallyPaid: "49.31",
    ...o,
  });

  it("settles a full finished payment", () => {
    expect(decideSettlement(charge, report())).toEqual({ kind: "apply", status: "paid", actuallyPaid: "49.31" });
  });
  it("finished but underpaid stays pending", () => {
    expect(decideSettlement(charge, report({ actuallyPaid: "40" }))).toMatchObject({ kind: "apply", status: "pending" });
    expect(decideSettlement(charge, report({ actuallyPaid: undefined }))).toMatchObject({ status: "pending" });
  });
  it("uses the stored pay_amount, not a lowered one in the report", () => {
    expect(decideSettlement(charge, report({ payAmount: "1", actuallyPaid: "1" }))).toMatchObject({ status: "pending" });
  });
  it("partially_paid is pending even if the amount looks complete", () => {
    expect(decideSettlement(charge, report({ status: "partially_paid" }))).toMatchObject({ status: "pending" });
  });
  it("rejects order id, payment id, currency or price mismatches", () => {
    expect(decideSettlement(charge, report({ orderId: "other" }))).toEqual({ kind: "ignore", reason: "mismatch" });
    expect(decideSettlement(charge, report({ paymentId: "1" }))).toEqual({ kind: "ignore", reason: "mismatch" });
    expect(decideSettlement(charge, report({ priceCurrency: "eur" }))).toEqual({ kind: "ignore", reason: "mismatch" });
    expect(decideSettlement(charge, report({ priceAmount: "48.99" }))).toEqual({ kind: "ignore", reason: "mismatch" });
    expect(decideSettlement(charge, report({ priceAmount: undefined }))).toEqual({ kind: "ignore", reason: "mismatch" });
  });
  it("never overwrites paid except by a refund, never overwrites refunded", () => {
    const paid = { ...charge, status: "paid" as const };
    expect(decideSettlement(paid, report({ status: "expired" }))).toEqual({ kind: "ignore", reason: "terminal" });
    expect(decideSettlement(paid, report({ status: "waiting" }))).toEqual({ kind: "ignore", reason: "terminal" });
    expect(decideSettlement(paid, report({ status: "refunded" }))).toMatchObject({ kind: "apply", status: "refunded" });
    const refunded = { ...charge, status: "refunded" as const };
    expect(decideSettlement(refunded, report())).toEqual({ kind: "ignore", reason: "terminal" });
  });
  it("a late full payment settles an expired charge", () => {
    expect(decideSettlement({ ...charge, status: "expired" }, report())).toMatchObject({ status: "paid" });
  });
});

describe("periods and access", () => {
  const now = new Date("2026-10-23T15:00:00Z");
  it("nextPeriod starts today when nothing is paid or the period lapsed", () => {
    expect(nextPeriod(null, now)).toEqual({ start: "2026-10-23", end: "2026-11-22" });
    expect(nextPeriod("2026-09-01", now)).toEqual({ start: "2026-10-23", end: "2026-11-22" });
  });
  it("nextPeriod stacks on an active period", () => {
    expect(nextPeriod("2026-11-05", now)).toEqual({ start: "2026-11-05", end: "2026-12-05" });
  });
  it("subscriptionAccess: unbilled, active, grace, restricted", () => {
    expect(subscriptionAccess(null, now)).toBe("unbilled");
    expect(subscriptionAccess("2026-10-23", now)).toBe("active");
    expect(subscriptionAccess("2026-10-20", now)).toBe("grace");
    expect(subscriptionAccess("2026-10-19", now)).toBe("restricted");
  });
  it("restricted plans include nothing; other states keep the plan", () => {
    expect(applySubscriptionAccess(PLANS.pro, "restricted").limits).toEqual({
      ai_messages: 0,
      broadcast_sends: 0,
      contacts: 0,
      seats: 0,
      whatsapp_numbers: 0,
    });
    expect(applySubscriptionAccess(PLANS.pro, "grace")).toBe(PLANS.pro);
  });
  it("period price comes from the plan definition", () => {
    expect(periodPriceUsd(PLANS.start)).toBe("49.00");
    expect(periodPriceUsd(PLANS.pro)).toBe("89.00");
  });
});
