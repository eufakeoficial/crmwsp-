import { describe, expect, it } from "vitest";
import { StripeProvider } from "../stripe/provider.js";
import { bytes, fixtureText, header, nowMs, SECRET_KEY, WEBHOOK_SECRET } from "./helpers.js";

const provider = new StripeProvider({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, now: nowMs });
function parse(name: string) {
  const body = fixtureText(name);
  return provider.parseWebhook(bytes(body), header(body));
}
const ref = { tenantId: "ten_01HZX", kind: "quote", id: "qte_01HZY" };
const occurredAt = new Date(1760918400 * 1000);

describe("Stripe event normalization", () => {
  it("completed + paid -> payment.succeeded with Stripe's amount", () => {
    expect(parse("checkout-completed")).toEqual([
      {
        type: "payment.succeeded",
        providerRef: "cs_test_a1B2c3D4e5F6",
        paymentRef: "pi_3Q1abcDEF456",
        amountMinor: 78000,
        currency: "EUR",
        reference: ref,
        occurredAt,
        dedupeKey: "evt_1Q1completed",
        verifiedBy: "webhook",
      },
    ]);
  });
  it("completed but unpaid (delayed method) is ignored", () => {
    expect(parse("checkout-completed-unpaid")[0]).toMatchObject({ type: "ignored", dedupeKey: "evt_1Q1unpaid" });
  });
  it("async_payment_succeeded -> payment.succeeded", () => {
    expect(parse("async-succeeded")[0]).toMatchObject({ type: "payment.succeeded", dedupeKey: "evt_1Q1asyncok", amountMinor: 78000 });
  });
  it("async_payment_failed -> payment.failed", () => {
    expect(parse("async-failed")[0]).toMatchObject({ type: "payment.failed", reference: ref });
  });
  it("expired -> payment.expired", () => {
    expect(parse("checkout-expired")[0]).toMatchObject({ type: "payment.expired", providerRef: "cs_test_a1B2c3D4e5F6" });
  });
  it("charge.refunded -> payment.refunded (cumulative, partial)", () => {
    expect(parse("charge-refunded")[0]).toMatchObject({
      type: "payment.refunded",
      providerRef: "pi_3Q1abcDEF456",
      amountMinor: 30000,
      fullyRefunded: false,
      reference: ref,
      currency: "EUR",
    });
  });
  it("unknown events are ignored", () => {
    expect(parse("customer-created")[0]).toEqual({
      type: "ignored",
      eventType: "customer.created",
      dedupeKey: "evt_1Q1other",
      occurredAt,
    });
  });
  it("normalizes zero-decimal currencies (CLP, JPY) without scaling", () => {
    for (const [cur, amount] of [["clp", 45000], ["jpy", 9800]] as const) {
      const ev = JSON.parse(fixtureText("checkout-completed"));
      ev.data.object.currency = cur;
      ev.data.object.amount_total = amount;
      const body = JSON.stringify(ev);
      expect(provider.parseWebhook(bytes(body), header(body))[0]).toMatchObject({ currency: cur.toUpperCase(), amountMinor: amount });
    }
  });
  it("missing metadata yields reference null; malformed payload throws non-retryable", () => {
    const ev = JSON.parse(fixtureText("checkout-completed"));
    ev.data.object.metadata = {};
    const body = JSON.stringify(ev);
    expect(provider.parseWebhook(bytes(body), header(body))[0]).toMatchObject({ reference: null });
    ev.data.object.amount_total = null;
    const bad = JSON.stringify(ev);
    expect(() => provider.parseWebhook(bytes(bad), header(bad))).toThrow(/Malformed/);
  });
  it("signed non-JSON body throws a provider error", () => {
    const body = "not json";
    expect(() => provider.parseWebhook(bytes(body), header(body))).toThrow(/not valid JSON/);
  });
});
