import { describe, expect, it } from "vitest";
import { InvalidSignatureError } from "../errors.js";
import { StripeProvider } from "../stripe/provider.js";
import { bytes, fixtureText, header, nowMs, NOW_S, sign, SECRET_KEY, WEBHOOK_SECRET } from "./helpers.js";

const provider = () => new StripeProvider({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, now: nowMs });
const body = fixtureText("checkout-completed");

describe("Stripe webhook signature", () => {
  it("accepts a valid signature", () => {
    expect(provider().parseWebhook(bytes(body), header(body))).toHaveLength(1);
  });
  it("accepts mixed-case header name", () => {
    expect(provider().parseWebhook(bytes(body), { "Stripe-Signature": header(body)["stripe-signature"] })).toHaveLength(1);
  });
  it("rejects a wrong secret", () => {
    expect(() => provider().parseWebhook(bytes(body), header(body, NOW_S, "whsec_other"))).toThrow(InvalidSignatureError);
  });
  it("rejects a tampered body", () => {
    const tampered = body.replace("78000", "100");
    expect(() => provider().parseWebhook(bytes(tampered), header(body))).toThrow(InvalidSignatureError);
  });
  it("rejects missing, malformed or v1-less headers", () => {
    for (const h of [{}, { "stripe-signature": "" }, { "stripe-signature": "garbage" }, { "stripe-signature": `t=${NOW_S}` }, { "stripe-signature": `v1=${sign(body)}` }, { "stripe-signature": `t=${NOW_S},v1=zz` }]) {
      expect(() => provider().parseWebhook(bytes(body), h)).toThrow(InvalidSignatureError);
    }
  });
  it("rejects timestamps outside 300 s (past and future) but accepts the edge", () => {
    const old = NOW_S - 301;
    const future = NOW_S + 301;
    expect(() => provider().parseWebhook(bytes(body), header(body, old))).toThrow(InvalidSignatureError);
    expect(() => provider().parseWebhook(bytes(body), header(body, future))).toThrow(InvalidSignatureError);
    expect(provider().parseWebhook(bytes(body), header(body, NOW_S - 300))).toHaveLength(1);
  });
  it("a timestamp swapped after signing is rejected", () => {
    const h = { "stripe-signature": `t=${NOW_S - 10},v1=${sign(body)}` };
    expect(() => provider().parseWebhook(bytes(body), h)).toThrow(InvalidSignatureError);
  });
  it("accepts when any of several v1 matches", () => {
    const bad = "0".repeat(64);
    const h = { "stripe-signature": `t=${NOW_S},v1=${bad},v1=${sign(body)},v0=${bad}` };
    expect(provider().parseWebhook(bytes(body), h)).toHaveLength(1);
    const h2 = { "stripe-signature": `t=${NOW_S},v1=${bad},v1=${"1".repeat(64)}` };
    expect(() => provider().parseWebhook(bytes(body), h2)).toThrow(InvalidSignatureError);
  });
});
