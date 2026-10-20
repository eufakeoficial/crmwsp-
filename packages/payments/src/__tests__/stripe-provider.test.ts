import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { PaymentProviderError } from "../errors.js";
import { idempotencyKey, StripeProvider } from "../stripe/provider.js";
import { fixtureText, json, mockFetch, nowMs, SECRET_KEY, WEBHOOK_SECRET } from "./helpers.js";

const reference = { tenantId: "ten_01HZX", kind: "quote", id: "qte_01HZY" } as const;
const baseInput = {
  amountMinor: 78000,
  currency: "EUR",
  description: "Presupuesto QTE-0042: instalación de 2 equipos de aire",
  reference,
  successUrl: "https://app.example.com/pago/ok",
};
function make(responses: Parameters<typeof mockFetch>[0]) {
  const m = mockFetch(responses);
  const p = new StripeProvider({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, fetch: m.fetch, now: nowMs });
  return { p, ...m };
}
const ok = () => json(fixtureText("create-session-response"));

describe("StripeProvider.createPaymentLink", () => {
  it("sends the right request", async () => {
    const { p, calls } = make([ok()]);
    const link = await p.createPaymentLink(baseInput);
    expect(link.providerRef).toBe("cs_test_a1B2c3D4e5F6");
    expect(link.url.startsWith("https://checkout.stripe.com/")).toBe(true);
    expect(link.expiresAt).toEqual(new Date(1761004800 * 1000));

    const call = calls[0]!;
    expect(call.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("error");
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    const h = call.init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(h["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(h["idempotency-key"]).toBe(idempotencyKey(reference, 78000, "EUR"));

    const form = new URLSearchParams(call.init.body as string);
    expect(form.get("mode")).toBe("payment");
    expect(form.get("success_url")).toBe("https://app.example.com/pago/ok");
    expect(form.get("client_reference_id")).toBe("ten_01HZX:quote:qte_01HZY");
    expect(form.get("line_items[0][quantity]")).toBe("1");
    expect(form.get("line_items[0][price_data][currency]")).toBe("eur");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("78000");
    expect(form.get("line_items[0][price_data][product_data][name]")).toBe(baseInput.description);
    for (const prefix of ["metadata", "payment_intent_data[metadata]"]) {
      expect(form.get(`${prefix}[tenantId]`)).toBe("ten_01HZX");
      expect(form.get(`${prefix}[kind]`)).toBe("quote");
      expect(form.get(`${prefix}[id]`)).toBe("qte_01HZY");
    }
    expect(form.has("expires_at")).toBe(false);
  });

  it("idempotency key is stable for same ref+amount and differs otherwise", () => {
    expect(idempotencyKey(reference, 100, "EUR")).toBe(idempotencyKey(reference, 100, "EUR"));
    expect(idempotencyKey(reference, 100, "EUR")).not.toBe(idempotencyKey(reference, 101, "EUR"));
    expect(idempotencyKey(reference, 100, "EUR")).not.toBe(idempotencyKey({ ...reference, tenantId: "ten_2" }, 100, "EUR"));
  });

  it("sends expires_at as unix seconds and validates the window", async () => {
    const { p, calls } = make([ok()]);
    const at = new Date(nowMs() + 2 * 3600 * 1000);
    await p.createPaymentLink({ ...baseInput, expiresAt: at });
    expect(new URLSearchParams(calls[0]!.init.body as string).get("expires_at")).toBe(String(Math.floor(at.getTime() / 1000)));
    await expect(p.createPaymentLink({ ...baseInput, expiresAt: new Date(nowMs() + 60_000) })).rejects.toThrow(/expiresAt/);
    await expect(p.createPaymentLink({ ...baseInput, expiresAt: new Date(nowMs() + 48 * 3600_000) })).rejects.toThrow(/expiresAt/);
  });

  it("requires an https successUrl (or a default)", async () => {
    const { p } = make([ok()]);
    const { successUrl: _s, ...noUrl } = baseInput;
    await expect(p.createPaymentLink(noUrl)).rejects.toThrow(/successUrl/);
    await expect(p.createPaymentLink({ ...baseInput, successUrl: "http://x.test" })).rejects.toThrow(/successUrl/);
    const m = mockFetch([ok()]);
    const withDefault = new StripeProvider({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, fetch: m.fetch, defaultSuccessUrl: "https://a.test/ok" });
    await expect(withDefault.createPaymentLink(noUrl)).resolves.toBeDefined();
  });

  it.each([
    ["EUR", 78000, "eur", "78000"],
    ["USD", 1999, "usd", "1999"],
    ["CLP", 45000, "clp", "45000"],
    ["JPY", 9800, "jpy", "9800"],
    ["ISK", 5000, "isk", "500000"],
    ["KWD", 12340, "kwd", "12340"],
  ])("currency %s: %i minor -> %s %s", async (cur, minor, lower, sent) => {
    const { p, calls } = make([ok()]);
    await p.createPaymentLink({ ...baseInput, currency: cur, amountMinor: minor });
    const form = new URLSearchParams(calls[0]!.init.body as string);
    expect(form.get("line_items[0][price_data][currency]")).toBe(lower);
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe(sent);
  });

  it("rejects invalid amounts before any request", async () => {
    const { p, calls } = make([ok()]);
    await expect(p.createPaymentLink({ ...baseInput, amountMinor: 12345, currency: "KWD" })).rejects.toThrow();
    await expect(p.createPaymentLink({ ...baseInput, amountMinor: 0 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("rejects unexpected responses", async () => {
    const { p } = make([json(JSON.stringify({ id: "cs_x", url: "http://insecure.test" }))]);
    await expect(p.createPaymentLink(baseInput)).rejects.toBeInstanceOf(PaymentProviderError);
  });
});

describe("StripeProvider errors and secrecy", () => {
  async function failure(res: Response | Error): Promise<PaymentProviderError> {
    const { p } = make([res]);
    try {
      await p.createPaymentLink(baseInput);
    } catch (e) {
      return e as PaymentProviderError;
    }
    throw new Error("expected failure");
  }

  it("400 is not retryable and keeps only the provider code", async () => {
    const e = await failure(json(fixtureText("error-400"), 400));
    expect(e).toBeInstanceOf(PaymentProviderError);
    expect(e.retryable).toBe(false);
    expect(e.status).toBe(400);
    expect(e.providerCode).toBe("amount_too_small");
    expect(e.message).toBe("Stripe responded with HTTP 400");
    expect(JSON.stringify(e)).not.toContain("SECRETTAIL");
  });
  it.each([429, 500, 502, 503, 408, 409])("%i is retryable", async (status) => {
    expect((await failure(json("{}", status))).retryable).toBe(true);
  });
  it("401/403/404 are not retryable", async () => {
    for (const s of [401, 403, 404]) expect((await failure(json("{}", s))).retryable).toBe(false);
  });
  it("network errors are retryable and drop the cause", async () => {
    const e = await failure(new Error(`connect failed with ${SECRET_KEY}`));
    expect(e.retryable).toBe(true);
    expect(e.cause).toBeUndefined();
    expect(e.message).not.toContain(SECRET_KEY);
  });
  it("oversized responses are rejected", async () => {
    const m = mockFetch([json("x".repeat(2000))]);
    const p = new StripeProvider({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, fetch: m.fetch, maxResponseBytes: 1000 });
    await expect(p.createPaymentLink(baseInput)).rejects.toThrow(/size limit/);
  });
  it("never leaks keys via JSON.stringify, inspect, spread or errors", async () => {
    const { p } = make([json("{}", 500)]);
    const err = await p.createPaymentLink(baseInput).catch((e: unknown) => e);
    const dumps = [JSON.stringify(p), inspect(p, { depth: 5, showHidden: true }), JSON.stringify({ ...p }), String(p), inspect(err, { depth: 5 }), JSON.stringify(err)];
    for (const d of dumps) {
      expect(d).not.toContain(SECRET_KEY);
      expect(d).not.toContain(WEBHOOK_SECRET);
    }
  });
});

describe("StripeProvider.getPayment", () => {
  it("fetches the session and marks it as reconciliation", async () => {
    const { p, calls } = make([json(fixtureText("retrieve-session-paid"))]);
    const snap = await p.getPayment("cs_test_a1B2c3D4e5F6");
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_a1B2c3D4e5F6");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.body).toBeUndefined();
    expect(snap).toEqual({
      providerRef: "cs_test_a1B2c3D4e5F6",
      status: "succeeded",
      amountMinor: 78000,
      currency: "EUR",
      reference,
      verifiedBy: "reconciliation",
    });
  });
  it("maps pending and expired", async () => {
    const base = JSON.parse(fixtureText("retrieve-session-paid"));
    const a = make([json(JSON.stringify({ ...base, payment_status: "unpaid", status: "open" }))]);
    expect((await a.p.getPayment("cs_test_a1B2c3D4e5F6")).status).toBe("pending");
    const b = make([json(JSON.stringify({ ...base, payment_status: "unpaid", status: "expired" }))]);
    expect((await b.p.getPayment("cs_test_a1B2c3D4e5F6")).status).toBe("expired");
  });
  it("rejects refs that could alter the path", async () => {
    const { p, calls } = make([ok()]);
    await expect(p.getPayment("cs_test/../customers")).rejects.toThrow();
    await expect(p.getPayment("pi_123")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
