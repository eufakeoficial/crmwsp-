import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InvalidSignatureError,
  MercadoPagoProvider,
  buildExternalReference,
  majorToMinor,
  mercadoPagoEvent,
  parseExternalReference,
  parseMercadoPagoNotification,
} from "../index.js";

const SECRET = "mp_webhook_secret_value_123";
const TS = 1760918500;
const NOW = TS * 1000 + 10_000;
const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";

function sig(dataId: string, requestId: string, ts = TS, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
  return `ts=${ts},v1=${v1}`;
}
const body = (id: string) => new TextEncoder().encode(JSON.stringify({ action: "payment.updated", type: "payment", data: { id } }));

describe("parseMercadoPagoNotification", () => {
  it("accepts a valid signature and returns the payment id", () => {
    const n = parseMercadoPagoNotification(body("123456"), { "x-signature": sig("123456", "req-1"), "x-request-id": "req-1" }, { "data.id": "123456", type: "payment" }, SECRET, NOW);
    expect(n).toEqual({ kind: "payment", paymentId: "123456", action: "payment.updated" });
  });

  it("rejects a tampered or wrong-secret signature", () => {
    const headers = { "x-signature": sig("123456", "req-1", TS, "other"), "x-request-id": "req-1" };
    expect(() => parseMercadoPagoNotification(body("123456"), headers, { "data.id": "123456" }, SECRET, NOW)).toThrow(InvalidSignatureError);
    // Signed for a different payment id.
    const h2 = { "x-signature": sig("999", "req-1"), "x-request-id": "req-1" };
    expect(() => parseMercadoPagoNotification(body("123456"), h2, { "data.id": "123456" }, SECRET, NOW)).toThrow(InvalidSignatureError);
  });

  it("rejects a replayed notification outside the tolerance window", () => {
    const headers = { "x-signature": sig("123456", "req-1"), "x-request-id": "req-1" };
    expect(() => parseMercadoPagoNotification(body("123456"), headers, { "data.id": "123456" }, SECRET, NOW + 10 * 60 * 1000)).toThrow(InvalidSignatureError);
  });

  it("rejects missing headers and body/query id mismatch", () => {
    expect(() => parseMercadoPagoNotification(body("1"), {}, { "data.id": "1" }, SECRET, NOW)).toThrow(InvalidSignatureError);
    const headers = { "x-signature": sig("123", "r"), "x-request-id": "r" };
    expect(() => parseMercadoPagoNotification(body("456"), headers, { "data.id": "123" }, SECRET, NOW)).toThrow(InvalidSignatureError);
  });

  it("ignores non-payment topics after verifying", () => {
    const headers = { "x-signature": sig("77", "r"), "x-request-id": "r" };
    expect(parseMercadoPagoNotification(new Uint8Array(), headers, { "data.id": "77", type: "merchant_order" }, SECRET, NOW)).toEqual({ kind: "ignored", topic: "merchant_order" });
  });
});

describe("mercado pago payments", () => {
  const ref = buildExternalReference({ tenantId: TENANT, kind: "order", id: ORDER }, "abcdef0123456789");

  it("round-trips the external reference and converts amounts exactly", () => {
    expect(parseExternalReference(ref)).toEqual({ tenantId: TENANT, kind: "order", id: ORDER });
    expect(parseExternalReference("crmwsp:bad")).toBeNull();
    expect(majorToMinor(1500.5, "ARS")).toBe(150050);
    expect(majorToMinor(12000, "CLP")).toBe(12000);
    expect(majorToMinor(10.001, "ARS")).toBeNull();
  });

  it("fetches the payment from the API and builds an event only from it", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(url)} ${String((init?.headers as Record<string, string>)["authorization"])}`);
      return new Response(JSON.stringify({ id: 123456, status: "approved", transaction_amount: 1500.5, currency_id: "ARS", external_reference: ref, date_approved: "2026-10-20T10:00:00Z" }));
    }) as typeof globalThis.fetch;
    const mp = new MercadoPagoProvider({ accessToken: "APP_USR-token", fetch });
    const p = await mp.getPaymentById("123456");
    expect(calls).toEqual(["GET https://api.mercadopago.com/v1/payments/123456 Bearer APP_USR-token"]);
    const ev = mercadoPagoEvent(p);
    expect(ev).toMatchObject({ type: "payment.succeeded", providerRef: ref, amountMinor: 150050, currency: "ARS", verifiedBy: "webhook", dedupeKey: "mp:123456:approved" });
    expect(JSON.stringify(mp)).not.toContain("APP_USR");
  });

  it("does not treat pending or rejected payments as paid", () => {
    const base = { id: "1", amountMinor: 100, currency: "ARS", externalReference: ref, reference: null, occurredAt: new Date() };
    expect(mercadoPagoEvent({ ...base, status: "pending" }).type).toBe("ignored");
    expect(mercadoPagoEvent({ ...base, status: "rejected" }).type).toBe("ignored");
    expect(mercadoPagoEvent({ ...base, status: "refunded" }).type).toBe("payment.refunded");
  });

  it("rejects a payment response for a different id", async () => {
    const fetch = (async () => new Response(JSON.stringify({ id: 9, status: "approved", transaction_amount: 1, currency_id: "ARS" }))) as typeof globalThis.fetch;
    await expect(new MercadoPagoProvider({ accessToken: "t", fetch }).getPaymentById("123")).rejects.toThrow();
  });

  it("creates a preference with our external reference and notification url", async () => {
    let sent: Record<string, unknown> = {};
    const fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "pref-1", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" }));
    }) as typeof globalThis.fetch;
    const link = await new MercadoPagoProvider({ accessToken: "t", fetch }).createPaymentLink({
      amountMinor: 150050,
      currency: "ARS",
      description: "Pedido 7",
      reference: { tenantId: TENANT, kind: "order", id: ORDER },
      externalReference: ref,
      notificationUrl: "https://api.example.com/webhooks/mercadopago/tok",
    });
    expect(link).toMatchObject({ providerRef: ref, preferenceId: "pref-1" });
    expect(sent["external_reference"]).toBe(ref);
    expect((sent["items"] as Array<Record<string, unknown>>)[0]).toMatchObject({ unit_price: 1500.5, currency_id: "ARS" });
  });
});
