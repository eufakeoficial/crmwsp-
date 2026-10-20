import { describe, expect, it } from "vitest";
import {
  ORDER_ACTIONS,
  ORDER_STATUSES,
  availableOrderActions,
  computeLineBreakdown,
  divRoundHalfEven,
  isTerminalOrderStatus,
  sumLines,
  transitionOrder,
} from "./index.js";

describe("order state machine", () => {
  it("walks the shipping happy path", () => {
    expect(transitionOrder("draft", "confirm", "shipping")).toEqual({ ok: true, to: "pending_payment" });
    expect(transitionOrder("pending_payment", "mark_paid", "shipping")).toEqual({ ok: true, to: "paid" });
    expect(transitionOrder("paid", "fulfill", "shipping")).toEqual({ ok: true, to: "fulfilled" });
    expect(transitionOrder("fulfilled", "ship", "shipping")).toEqual({ ok: true, to: "shipped" });
    expect(transitionOrder("shipped", "deliver", "shipping")).toEqual({ ok: true, to: "delivered" });
  });
  it("non-shipping orders skip `shipped`", () => {
    expect(transitionOrder("fulfilled", "ship", "pickup")).toEqual({ ok: false, reason: "not_applicable" });
    expect(transitionOrder("fulfilled", "deliver", "pickup")).toEqual({ ok: true, to: "delivered" });
    expect(transitionOrder("fulfilled", "deliver", "shipping")).toEqual({ ok: false, reason: "invalid_state" });
  });
  it("cancel only before payment", () => {
    expect(transitionOrder("draft", "cancel", "pickup").ok).toBe(true);
    expect(transitionOrder("pending_payment", "cancel", "pickup").ok).toBe(true);
    for (const s of ["paid", "fulfilled", "shipped", "delivered", "cancelled", "refunded"] as const) {
      expect(transitionOrder(s, "cancel", "shipping").ok).toBe(false);
    }
  });
  it("terminal states allow nothing", () => {
    for (const s of ORDER_STATUSES.filter(isTerminalOrderStatus)) {
      expect(availableOrderActions(s, "shipping")).toEqual([]);
    }
  });
  it("only one forward action is legal from each non-terminal state", () => {
    for (const s of ORDER_STATUSES) {
      const n = ORDER_ACTIONS.filter((a) => transitionOrder(s, a, "shipping").ok).length;
      expect(n).toBeLessThanOrEqual(2);
    }
    expect(availableOrderActions("draft", "shipping")).toEqual(["confirm", "cancel"]);
  });
});

describe("line math", () => {
  it("rounds half to even", () => {
    expect(divRoundHalfEven(5n, 2n)).toBe(2n);
    expect(divRoundHalfEven(7n, 2n)).toBe(4n);
  });
  it("computes gross, discount, tax and total", () => {
    // 1.5 x 1000 = 1500; 10% off = 150 -> 1350; 21% tax = 283.5 -> 284 (half-even on 283.5 = 284)
    const l = computeLineBreakdown(1500n, 1000n, 1000, 2100);
    expect(l).toEqual({ gross: 1500n, discount: 150n, net: 1350n, tax: 284n, total: 1634n });
  });
  it("sums lines and adds shipping to the total only", () => {
    const a = computeLineBreakdown(1000n, 1000n, 0, 2100);
    const b = computeLineBreakdown(2000n, 500n, 0, 0);
    expect(sumLines([a, b], 300n)).toEqual({ subtotal: 2000n, discount: 0n, tax: 210n, total: 1210n + 1000n + 300n });
  });
  it("rejects invalid input", () => {
    expect(() => computeLineBreakdown(0n, 1n)).toThrow(RangeError);
    expect(() => computeLineBreakdown(1n, 1n, 10_001)).toThrow(RangeError);
  });
});
