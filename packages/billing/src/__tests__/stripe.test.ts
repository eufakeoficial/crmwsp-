import { describe, expect, it } from "vitest";
import {
  decideStripeInvoice,
  expectedInvoiceMinor,
  mapStripeSubscriptionStatus,
  resolveStripePrice,
  stripePriceMapFromEnv,
  type StripeInvoiceReport,
} from "../stripe.js";

const env = {
  STRIPE_PRICE_START_MONTHLY: "price_sm",
  STRIPE_PRICE_START_ANNUAL: "price_sa",
  STRIPE_PRICE_PRO_MONTHLY: "price_pm",
  STRIPE_PRICE_PRO_ANNUAL: "price_pa",
};
const map = stripePriceMapFromEnv(env);
const invoice = (o: Partial<StripeInvoiceReport> = {}): StripeInvoiceReport => ({
  invoiceId: "in_1",
  customerId: "cus_1",
  subscriptionId: "sub_1",
  status: "paid",
  priceId: "price_sm",
  amountPaidMinor: 4900,
  currency: "usd",
  ...o,
});

describe("stripePriceMapFromEnv / resolveStripePrice", () => {
  it("maps the four configured price ids to plan and period", () => {
    expect(resolveStripePrice("price_sm", map)).toEqual({ plan: "start", period: "monthly" });
    expect(resolveStripePrice("price_sa", map)).toEqual({ plan: "start", period: "annual" });
    expect(resolveStripePrice("price_pm", map)).toEqual({ plan: "pro", period: "monthly" });
    expect(resolveStripePrice("price_pa", map)).toEqual({ plan: "pro", period: "annual" });
  });
  it("returns null for unknown or missing ids and ignores blank env values", () => {
    expect(resolveStripePrice("price_x", map)).toBeNull();
    expect(resolveStripePrice(null, map)).toBeNull();
    expect(resolveStripePrice("", stripePriceMapFromEnv({ STRIPE_PRICE_START_MONTHLY: "  " }))).toBeNull();
  });
});

describe("expectedInvoiceMinor", () => {
  it("is the plan price in cents (49/490 and 89/890)", () => {
    expect(expectedInvoiceMinor("start", "monthly")).toBe(4900);
    expect(expectedInvoiceMinor("start", "annual")).toBe(49000);
    expect(expectedInvoiceMinor("pro", "monthly")).toBe(8900);
    expect(expectedInvoiceMinor("pro", "annual")).toBe(89000);
  });
});

describe("decideStripeInvoice", () => {
  it("settles a paid invoice for a known price with the exact amount", () => {
    expect(decideStripeInvoice(invoice(), map)).toEqual({ kind: "settle", plan: "start", period: "monthly", periodDays: 30, amountMinor: 4900, currency: "usd" });
    expect(decideStripeInvoice(invoice({ priceId: "price_pa", amountPaidMinor: 89000 }), map)).toMatchObject({ kind: "settle", plan: "pro", period: "annual", periodDays: 365 });
  });
  it("never settles an invoice that is not paid", () => {
    for (const status of ["open", "draft", "uncollectible", "void"] as const) {
      expect(decideStripeInvoice(invoice({ status }), map)).toEqual({ kind: "ignore", reason: "not_paid" });
    }
  });
  it("ignores unknown prices, wrong amounts and wrong currencies", () => {
    expect(decideStripeInvoice(invoice({ priceId: "price_other" }), map)).toEqual({ kind: "ignore", reason: "unknown_price" });
    expect(decideStripeInvoice(invoice({ priceId: null }), map)).toEqual({ kind: "ignore", reason: "unknown_price" });
    expect(decideStripeInvoice(invoice({ amountPaidMinor: 4800 }), map)).toEqual({ kind: "ignore", reason: "amount_mismatch" });
    expect(decideStripeInvoice(invoice({ amountPaidMinor: 0 }), map)).toEqual({ kind: "ignore", reason: "amount_mismatch" });
    expect(decideStripeInvoice(invoice({ currency: "eur" }), map)).toEqual({ kind: "ignore", reason: "currency_mismatch" });
  });
  it("treats currency case-insensitively", () => {
    expect(decideStripeInvoice(invoice({ currency: "USD" }), map).kind).toBe("settle");
  });
});

describe("mapStripeSubscriptionStatus", () => {
  it("maps the known statuses and rejects anything else", () => {
    for (const s of ["incomplete", "trialing", "active", "past_due", "unpaid", "canceled", "paused"]) expect(mapStripeSubscriptionStatus(s)).toBe(s);
    expect(mapStripeSubscriptionStatus("incomplete_expired")).toBe("canceled");
    expect(mapStripeSubscriptionStatus("weird")).toBeNull();
  });
});
