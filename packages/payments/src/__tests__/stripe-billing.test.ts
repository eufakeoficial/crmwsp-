import { describe, expect, it } from "vitest";
import { PaymentProviderError, StripeBillingClient, parseStripeBillingEvent, stripeBillingOptionsFromEnv } from "../index.js";
import { SECRET_KEY, json, mockFetch } from "./helpers.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const client = (responses: Parameters<typeof mockFetch>[0]) => {
  const m = mockFetch(responses);
  return { c: new StripeBillingClient({ secretKey: SECRET_KEY, fetch: m.fetch }), calls: m.calls };
};
const form = (init: RequestInit) => new URLSearchParams(String(init.body));

describe("stripeBillingOptionsFromEnv", () => {
  it("is null (feature off) without a key", () => {
    expect(stripeBillingOptionsFromEnv({})).toBeNull();
    expect(stripeBillingOptionsFromEnv({ STRIPE_SECRET_KEY: "  " })).toBeNull();
    expect(stripeBillingOptionsFromEnv({ STRIPE_SECRET_KEY: SECRET_KEY })).toEqual({ secretKey: SECRET_KEY });
  });
});

describe("StripeBillingClient", () => {
  it("creates a customer with the tenant in metadata and a per-tenant idempotency key", async () => {
    const { c, calls } = client([json(JSON.stringify({ id: "cus_123" }))]);
    await expect(c.createCustomer({ tenantId: TENANT, name: "Acme" })).resolves.toEqual({ id: "cus_123" });
    const call = calls[0]!;
    expect(call.url).toBe("https://api.stripe.com/v1/customers");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${SECRET_KEY}`);
    expect(headers["idempotency-key"]).toBe(`crmwsp-customer-${TENANT}`);
    expect(form(call.init).get("metadata[tenant_id]")).toBe(TENANT);
  });

  it("creates a subscription Checkout session for the configured price without promotion codes", async () => {
    const { c, calls } = client([json(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }))]);
    const out = await c.createCheckoutSession({
      customerId: "cus_123",
      priceId: "price_sm",
      tenantId: TENANT,
      plan: "start",
      period: "monthly",
      successUrl: "https://app.example.com/ok",
      cancelUrl: "https://app.example.com/no",
    });
    expect(out).toEqual({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    const f = form(calls[0]!.init);
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(f.get("mode")).toBe("subscription");
    expect(f.get("customer")).toBe("cus_123");
    expect(f.get("line_items[0][price]")).toBe("price_sm");
    expect(f.get("client_reference_id")).toBe(TENANT);
    expect(f.get("allow_promotion_codes")).toBe("false");
    expect(f.get("subscription_data[metadata][plan]")).toBe("start");
  });

  it("creates a portal session", async () => {
    const { c, calls } = client([json(JSON.stringify({ id: "bps_1", url: "https://billing.stripe.com/p/session/x" }))]);
    await expect(c.createPortalSession({ customerId: "cus_123", returnUrl: "https://app.example.com/billing" })).resolves.toMatchObject({ id: "bps_1" });
    expect(form(calls[0]!.init).get("return_url")).toBe("https://app.example.com/billing");
  });

  it("rejects non-https return URLs and bad identifiers before calling Stripe", async () => {
    const { c, calls } = client([json("{}")]);
    await expect(c.createPortalSession({ customerId: "cus_123", returnUrl: "http://x.test" })).rejects.toThrow();
    await expect(
      c.createCheckoutSession({ customerId: "nope", priceId: "price_1", tenantId: TENANT, plan: "pro", period: "annual", successUrl: "https://a.test", cancelUrl: "https://a.test" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("maps HTTP errors with retry semantics and never leaks the key", async () => {
    const { c } = client([json(JSON.stringify({ error: { message: SECRET_KEY } }), 500)]);
    const err = await c.createCustomer({ tenantId: TENANT }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as PaymentProviderError).retryable).toBe(true);
    expect(String((err as Error).message)).not.toContain(SECRET_KEY);
    const bad = await client([json("{}", 402)]).c.createCustomer({ tenantId: TENANT }).catch((e: unknown) => e);
    expect((bad as PaymentProviderError).retryable).toBe(false);
  });

  it("does not serialize the secret key", () => {
    expect(JSON.stringify(new StripeBillingClient({ secretKey: SECRET_KEY }))).not.toContain(SECRET_KEY);
  });
});

const event = (type: string, object: Record<string, unknown>) => ({ id: "evt_1", type, created: 1800000000, data: { object } });

describe("parseStripeBillingEvent", () => {
  it("normalizes checkout.session.completed", () => {
    expect(parseStripeBillingEvent(event("checkout.session.completed", { customer: "cus_1", subscription: "sub_1", client_reference_id: TENANT }))).toEqual({
      kind: "checkout_completed",
      eventId: "evt_1",
      createdAt: new Date(1800000000 * 1000),
      paymentStatus: null,
      customerId: "cus_1",
      subscriptionId: "sub_1",
      clientReferenceId: TENANT,
    });
  });

  it("normalizes invoice.paid in the classic and the newer shape", () => {
    const classic = parseStripeBillingEvent(
      event("invoice.paid", {
        id: "in_1",
        customer: "cus_1",
        subscription: "sub_1",
        status: "paid",
        amount_paid: 4900,
        currency: "usd",
        lines: { data: [{ price: { id: "price_sm" } }] },
      }),
    );
    const modern = parseStripeBillingEvent(
      event("invoice.paid", {
        id: "in_1",
        customer: "cus_1",
        status: "paid",
        amount_paid: 4900,
        currency: "usd",
        parent: { subscription_details: { subscription: "sub_1" } },
        lines: { data: [{ pricing: { price_details: { price: "price_sm" } } }] },
      }),
    );
    const expected = {
      kind: "invoice_paid",
      eventId: "evt_1",
      createdAt: new Date(1800000000 * 1000),
      customerId: "cus_1",
      invoice: { invoiceId: "in_1", customerId: "cus_1", subscriptionId: "sub_1", status: "paid", priceId: "price_sm", amountPaidMinor: 4900, currency: "usd" },
    };
    expect(classic).toEqual(expected);
    expect(modern).toEqual(expected);
  });

  it("normalizes payment failures and subscription updates/deletions", () => {
    expect(parseStripeBillingEvent(event("invoice.payment_failed", { id: "in_2", customer: { id: "cus_1" }, subscription: "sub_1" }))).toMatchObject({
      kind: "invoice_payment_failed",
      customerId: "cus_1",
      invoiceId: "in_2",
      subscriptionId: "sub_1",
    });
    const sub = { id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: true, items: { data: [{ price: { id: "price_pa" }, current_period_end: 1800000000 }] } };
    expect(parseStripeBillingEvent(event("customer.subscription.updated", sub))).toMatchObject({
      kind: "subscription_updated",
      subscription: { subscriptionId: "sub_1", status: "active", priceId: "price_pa", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(1800000000 * 1000) },
    });
    expect(parseStripeBillingEvent(event("customer.subscription.deleted", { ...sub, status: "canceled" })).kind).toBe("subscription_deleted");
  });

  it("ignores unknown or malformed events without throwing", () => {
    expect(parseStripeBillingEvent(event("charge.refunded", {})).kind).toBe("ignored");
    expect(parseStripeBillingEvent(event("invoice.paid", { id: "in_1" })).kind).toBe("ignored");
    expect(parseStripeBillingEvent(null).kind).toBe("ignored");
    expect(parseStripeBillingEvent("x").kind).toBe("ignored");
  });
});
