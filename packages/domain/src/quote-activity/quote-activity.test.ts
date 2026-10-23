import { describe, expect, it } from "vitest";
import { buildQuoteActivity, type QuoteActivityInput } from "./index.js";

const d = (s: string): Date => new Date(`2026-10-${s}Z`);

const base: QuoteActivityInput = {
  quote: { id: "q1", createdAt: d("01T10:00:00"), approvedAt: null, sentAt: null, acceptedAt: null },
  orders: [],
  reviews: [],
  payments: [],
  manualPayments: [],
};
const order = { id: "o1", number: "P-1", createdAt: d("02T10:00:00"), paidAt: null, cancelledAt: null };

describe("buildQuoteActivity", () => {
  it("lists only the quote creation for a fresh draft", () => {
    expect(buildQuoteActivity(base).map((e) => e.kind)).toEqual(["quote_created"]);
  });

  it("derives the quote lifecycle from its timestamps, oldest first", () => {
    const out = buildQuoteActivity({
      ...base,
      quote: { ...base.quote, approvedAt: d("01T11:00:00"), sentAt: d("01T12:00:00"), acceptedAt: d("02T09:00:00") },
    });
    expect(out.map((e) => e.kind)).toEqual(["quote_created", "quote_approved", "quote_sent", "quote_accepted"]);
    expect(out[3]?.at).toBe("2026-10-02T09:00:00.000Z");
  });

  it("adds order, receipt and a webhook-verified payment", () => {
    const out = buildQuoteActivity({
      ...base,
      orders: [{ ...order, paidAt: d("03T10:00:00") }],
      reviews: [{ id: "r1", orderId: "o1", status: "pending", createdAt: d("02T12:00:00"), reviewedAt: null }],
      payments: [{ orderId: "o1", paidAt: d("03T10:00:00"), verifiedBy: "webhook" }],
    });
    expect(out.map((e) => e.kind)).toEqual(["quote_created", "order_created", "payment_review_received", "order_paid"]);
    expect(out[3]).toMatchObject({ orderNumber: "P-1", verifiedBy: "webhook" });
  });

  it("reports reconciliation and manual verifiers, preferring the provider over manual", () => {
    const paid = { ...order, paidAt: d("03T10:00:00") };
    const recon = buildQuoteActivity({
      ...base,
      orders: [paid],
      payments: [{ orderId: "o1", paidAt: d("03T10:00:00"), verifiedBy: "reconciliation" }],
      manualPayments: [{ orderId: "o1", at: d("03T11:00:00") }],
    });
    expect(recon.filter((e) => e.kind === "order_paid")).toHaveLength(1);
    expect(recon.find((e) => e.kind === "order_paid")?.verifiedBy).toBe("reconciliation");

    const manual = buildQuoteActivity({ ...base, orders: [paid], manualPayments: [{ orderId: "o1", at: d("03T11:00:00") }] });
    expect(manual.find((e) => e.kind === "order_paid")).toMatchObject({ verifiedBy: "manual", at: "2026-10-03T11:00:00.000Z" });
  });

  it("ignores unverified provider payments and falls back to order.paidAt with unknown verifier", () => {
    const out = buildQuoteActivity({
      ...base,
      orders: [{ ...order, paidAt: d("03T10:00:00") }],
      payments: [{ orderId: "o1", paidAt: null, verifiedBy: null }],
    });
    expect(out.find((e) => e.kind === "order_paid")).toMatchObject({ verifiedBy: null });
  });

  it("does not invent paid events and records review outcomes and cancellations", () => {
    const out = buildQuoteActivity({
      ...base,
      orders: [{ ...order, cancelledAt: d("05T10:00:00") }],
      reviews: [{ id: "r1", orderId: "o1", status: "rejected", createdAt: d("02T12:00:00"), reviewedAt: d("02T13:00:00") }],
    });
    expect(out.map((e) => e.kind)).toEqual([
      "quote_created",
      "order_created",
      "payment_review_received",
      "payment_review_rejected",
      "order_cancelled",
    ]);
  });

  it("ignores reviews of other orders and breaks timestamp ties by lifecycle order", () => {
    const t = d("01T10:00:00");
    const out = buildQuoteActivity({
      ...base,
      quote: { ...base.quote, createdAt: t, approvedAt: t },
      reviews: [{ id: "r9", orderId: "other", status: "pending", createdAt: t, reviewedAt: null }],
    });
    expect(out.map((e) => e.kind)).toEqual(["quote_created", "quote_approved"]);
  });
});
