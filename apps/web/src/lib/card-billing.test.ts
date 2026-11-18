import { describe, expect, it } from "vitest";
import { CARD_STATUS_LABEL, cardPeriodsFor, cardReturnNotice, isStripeRedirect } from "./card-billing";

const available = [
  { plan: "start", period: "monthly" },
  { plan: "pro", period: "monthly" },
  { plan: "pro", period: "annual" },
] as const;

describe("isStripeRedirect", () => {
  it("only accepts https URLs on stripe.com hosts", () => {
    expect(isStripeRedirect("https://checkout.stripe.com/c/pay/cs_1")).toBe(true);
    expect(isStripeRedirect("https://billing.stripe.com/p/session/x")).toBe(true);
    expect(isStripeRedirect("http://checkout.stripe.com/c")).toBe(false);
    expect(isStripeRedirect("https://stripe.com.evil.test/c")).toBe(false);
    expect(isStripeRedirect("https://evilstripe.com/c")).toBe(false);
    expect(isStripeRedirect("javascript:alert(1)")).toBe(false);
    expect(isStripeRedirect("not a url")).toBe(false);
  });
});

describe("cardPeriodsFor", () => {
  it("lists the periods with a configured price for a plan", () => {
    expect(cardPeriodsFor(available, "start")).toEqual(["monthly"]);
    expect(cardPeriodsFor(available, "pro")).toEqual(["monthly", "annual"]);
    expect(cardPeriodsFor([], "pro")).toEqual([]);
  });
});

describe("cardReturnNotice", () => {
  it("explains the checkout return without claiming the payment is confirmed", () => {
    expect(cardReturnNotice("success")).toMatch(/confirm/i);
    expect(cardReturnNotice("cancel")).toMatch(/cancel/i);
    expect(cardReturnNotice(null)).toBeNull();
    expect(cardReturnNotice("other")).toBeNull();
  });
});

describe("CARD_STATUS_LABEL", () => {
  it("has a Spanish label for every status", () => {
    for (const s of ["none", "incomplete", "trialing", "active", "past_due", "unpaid", "canceled", "paused"] as const) {
      expect(CARD_STATUS_LABEL[s].length).toBeGreaterThan(3);
    }
  });
});
