import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InvalidSignatureError, PaymentProviderError } from "../errors.js";
import {
  NowPaymentsProvider,
  parseNowPaymentsPayment,
  signNowPaymentsPayload,
  sortKeysDeep,
  verifyNowPaymentsSignature,
} from "./provider.js";

const SECRET = "ipn-secret-test";

describe("NOWPayments IPN signature", () => {
  const body = { payment_status: "finished", payment_id: 5077125051, order_id: "o-1", fee: { depositFee: 1, currency: "usd" }, list: [3, 1, 2] };

  it("sorts keys recursively and keeps array order", () => {
    expect(JSON.stringify(sortKeysDeep(body))).toBe(
      '{"fee":{"currency":"usd","depositFee":1},"list":[3,1,2],"order_id":"o-1","payment_id":5077125051,"payment_status":"finished"}',
    );
  });

  it("matches an independent HMAC-SHA512 over the sorted JSON", () => {
    const expected = createHmac("sha512", SECRET).update(JSON.stringify(sortKeysDeep(body))).digest("hex");
    expect(signNowPaymentsPayload(body, SECRET)).toBe(expected);
    expect(() => verifyNowPaymentsSignature(body, expected, SECRET)).not.toThrow();
    expect(() => verifyNowPaymentsSignature(body, expected.toUpperCase(), SECRET)).not.toThrow();
  });

  it("rejects tampered bodies, wrong secrets, bad lengths and missing headers", () => {
    const sig = signNowPaymentsPayload(body, SECRET);
    expect(() => verifyNowPaymentsSignature({ ...body, payment_status: "refunded" }, sig, SECRET)).toThrow(InvalidSignatureError);
    expect(() => verifyNowPaymentsSignature(body, sig, "other")).toThrow(InvalidSignatureError);
    expect(() => verifyNowPaymentsSignature(body, sig.slice(0, 64), SECRET)).toThrow(InvalidSignatureError);
    expect(() => verifyNowPaymentsSignature(body, undefined, SECRET)).toThrow(InvalidSignatureError);
    expect(() => verifyNowPaymentsSignature(body, sig, "")).toThrow(InvalidSignatureError);
  });
});

describe("parseNowPaymentsPayment", () => {
  it("normalizes a numeric payment_id to string", () => {
    expect(parseNowPaymentsPayment({ payment_id: 42, payment_status: "waiting" }).paymentId).toBe("42");
  });
  it("rejects payloads without id or status", () => {
    expect(() => parseNowPaymentsPayment({ payment_status: "waiting" })).toThrow(PaymentProviderError);
    expect(() => parseNowPaymentsPayment([])).toThrow(PaymentProviderError);
  });
});

describe("NowPaymentsProvider", () => {
  const okJson = (data: unknown) => new Response(JSON.stringify(data), { status: 201, headers: { "content-type": "application/json" } });

  it("creates a fixed-rate payment with x-api-key and our order id", async () => {
    const fetch = vi.fn(async () =>
      okJson({ payment_id: 77, payment_status: "waiting", pay_address: "0xabc", pay_amount: 49.31, pay_currency: "usdtbsc", order_id: "ord-1" }),
    );
    const p = new NowPaymentsProvider({ apiKey: "k-secret", baseUrl: "https://api-sandbox.nowpayments.io/v1/", fetch });
    const out = await p.createPayment({ orderId: "ord-1", priceAmount: "49.00", priceCurrency: "USD", ipnCallbackUrl: "https://x.test/ipn" });
    expect(out).toEqual({ paymentId: "77", payAddress: "0xabc", payAmount: "49.31", payCurrency: "usdtbsc", status: "waiting" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-sandbox.nowpayments.io/v1/payment");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k-secret");
    expect(JSON.parse(init.body as string)).toEqual({
      price_amount: 49,
      price_currency: "usd",
      pay_currency: "usdtbsc",
      order_id: "ord-1",
      ipn_callback_url: "https://x.test/ipn",
      is_fixed_rate: true,
    });
    expect(JSON.stringify(p)).not.toContain("k-secret");
  });

  it("maps HTTP errors to retryable provider errors without leaking the key", async () => {
    const p = new NowPaymentsProvider({ apiKey: "k-secret", fetch: vi.fn(async () => new Response("boom", { status: 503 })) });
    const err = await p.getPayment("77").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as PaymentProviderError).retryable).toBe(true);
    expect(String((err as Error).message)).not.toContain("k-secret");
  });

  it("refuses a non-https IPN url and non-numeric ids", async () => {
    const p = new NowPaymentsProvider({ apiKey: "k", fetch: vi.fn() });
    await expect(p.createPayment({ orderId: "o", priceAmount: "1.00", priceCurrency: "usd", ipnCallbackUrl: "http://x" })).rejects.toThrow();
    await expect(p.getPayment("../x")).rejects.toThrow();
  });
});
