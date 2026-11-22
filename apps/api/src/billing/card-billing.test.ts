import { createHmac } from "node:crypto";
import { stripePriceMapFromEnv } from "@crmwsp/billing";
import { ExternalProviderError, SETTLE_STRIPE_BILLING_EVENT_JOB, ValidationError } from "@crmwsp/contracts";
import { PaymentProviderError, type StripeBillingClient } from "@crmwsp/payments";
import { describe, expect, it, vi } from "vitest";
import type { TenantDb } from "../db/tenant-db.js";
import { CardBillingService, billingReturnUrl, type StripeBillingEventStore } from "./card-billing.service.js";
import { StripeBillingWebhookController } from "./stripe-billing-webhook.controller.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const WEBHOOK_SECRET = "whsec_test_not_real";
const prices = stripePriceMapFromEnv({ STRIPE_PRICE_START_MONTHLY: "price_sm", STRIPE_PRICE_PRO_ANNUAL: "price_pa" });

const eventBody = (type: string, object: Record<string, unknown>, id = "evt_1") => ({ id, type, created: 1_800_000_000, data: { object } });
const paidInvoice = eventBody("invoice.paid", {
  id: "in_1",
  customer: "cus_1",
  status: "paid",
  amount_paid: 4900,
  currency: "usd",
  lines: { data: [{ price: { id: "price_sm" } }] },
});

function makeService(opts: { stripe?: Partial<StripeBillingClient> | null; stored?: { eventId: string; tenantId: string; inserted: boolean } | null; queueFails?: boolean } = {}) {
  const ingest = vi.fn(async () => (opts.stored === undefined ? { eventId: "e-1", tenantId: TENANT, inserted: true } : opts.stored));
  const store: StripeBillingEventStore = { ingest };
  const add = vi.fn(async () => {
    if (opts.queueFails) throw new Error("redis down");
  });
  const service = new CardBillingService((opts.stripe === undefined ? null : opts.stripe) as StripeBillingClient | null, prices, store, { add } as never);
  return { service, ingest, add };
}

/** db.run executes the callback against a tx whose selects resolve to the queued results. */
function fakeDb(selects: unknown[][], executeRows: unknown[] = []) {
  const queue = [...selects];
  const tx = {
    select: () => {
      const result = queue.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const k of ["from", "where", "limit"]) chain[k] = () => chain;
      chain["then"] = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      return chain;
    },
    execute: async () => executeRows,
  };
  return { tenantId: TENANT, userId: "u", run: <T>(fn: (t: unknown) => Promise<T>) => fn(tx) } as unknown as TenantDb;
}

describe("CardBillingService.status", () => {
  it("is disabled without a Stripe client and lists only configured plan/period pairs when enabled", async () => {
    const off = await makeService({ stripe: null }).service.status(fakeDb([[]]));
    expect(off).toEqual({ enabled: false, available: [], subscription: null });
    const on = await makeService({ stripe: {} }).service.status(fakeDb([[]]));
    expect(on.enabled).toBe(true);
    expect(on.available).toEqual([
      { plan: "start", period: "monthly" },
      { plan: "pro", period: "annual" },
    ]);
  });

  it("mirrors the stored subscription without exposing provider ids", async () => {
    const end = new Date("2026-12-01T00:00:00Z");
    const row = { stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "active", plan: "pro", period: "annual", cancelAtPeriodEnd: true, currentPeriodEnd: end };
    const out = await makeService({ stripe: {} }).service.status(fakeDb([[row]]));
    expect(out.subscription).toEqual({ status: "active", plan: "pro", period: "annual", cancelAtPeriodEnd: true, currentPeriodEnd: end.toISOString() });
    expect(JSON.stringify(out)).not.toContain("cus_1");
    expect(JSON.stringify(out)).not.toContain("sub_1");
  });
});

describe("CardBillingService.checkout / portal", () => {
  it("answers a provider error (502) when Stripe is not configured", async () => {
    await expect(makeService({ stripe: null }).service.checkout(fakeDb([]), "start", "monthly", "https://app.test")).rejects.toBeInstanceOf(ExternalProviderError);
    await expect(makeService({ stripe: null }).service.portal(fakeDb([]), "https://app.test")).rejects.toBeInstanceOf(ExternalProviderError);
  });

  it("refuses a plan/period without a configured price before touching Stripe", async () => {
    const createCustomer = vi.fn();
    const { service } = makeService({ stripe: { createCustomer } });
    await expect(service.checkout(fakeDb([]), "pro", "monthly", "https://app.test")).rejects.toBeInstanceOf(ValidationError);
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("reuses the stored customer and sends the browser to Stripe with the configured price", async () => {
    const createCheckoutSession = vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }));
    const createCustomer = vi.fn();
    const { service } = makeService({ stripe: { createCheckoutSession, createCustomer } });
    const out = await service.checkout(fakeDb([[{ id: "cus_1" }]]), "start", "monthly", "https://app.test/");
    expect(out).toEqual({ url: "https://checkout.stripe.com/c/cs_1" });
    expect(createCustomer).not.toHaveBeenCalled();
    expect(createCheckoutSession).toHaveBeenCalledWith({
      customerId: "cus_1",
      priceId: "price_sm",
      tenantId: TENANT,
      plan: "start",
      period: "monthly",
      successUrl: "https://app.test/app/settings/billing?card=success",
      cancelUrl: "https://app.test/app/settings/billing?card=cancel",
    });
  });

  it("creates and stores the customer on first use", async () => {
    const createCustomer = vi.fn(async () => ({ id: "cus_new" }));
    const createCheckoutSession = vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }));
    const { service } = makeService({ stripe: { createCustomer, createCheckoutSession } });
    await service.checkout(fakeDb([[], [{ name: "Acme" }]], [{ id: "cus_new" }]), "start", "monthly", "https://app.test");
    expect(createCustomer).toHaveBeenCalledWith({ tenantId: TENANT, name: "Acme" });
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cus_new" }));
  });

  it("maps a Stripe failure to a generic provider error without leaking details", async () => {
    const createCheckoutSession = vi.fn(async () => {
      throw new PaymentProviderError("stripe", "Stripe responded with HTTP 500 sk_live_secret", true, { status: 500 });
    });
    const { service } = makeService({ stripe: { createCheckoutSession } });
    const err = await service.checkout(fakeDb([[{ id: "cus_1" }]]), "start", "monthly", "https://app.test").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExternalProviderError);
    expect(String((err as Error).message)).not.toContain("sk_live");
  });

  it("portal needs an existing customer", async () => {
    const createPortalSession = vi.fn(async () => ({ id: "bps_1", url: "https://billing.stripe.com/p/1" }));
    const { service } = makeService({ stripe: { createPortalSession } });
    await expect(service.portal(fakeDb([[]]), "https://app.test")).rejects.toBeInstanceOf(ValidationError);
    await expect(service.portal(fakeDb([[{ id: "cus_1" }]]), "https://app.test")).resolves.toEqual({ url: "https://billing.stripe.com/p/1" });
    expect(createPortalSession).toHaveBeenCalledWith({ customerId: "cus_1", returnUrl: "https://app.test/app/settings/billing" });
  });
});

describe("CardBillingService.ingestEvent", () => {
  it("stores the event under the stripe_billing dedupe key and enqueues its settlement", async () => {
    const { service, ingest, add } = makeService();
    await expect(service.ingestEvent(paidInvoice)).resolves.toBe(true);
    expect(ingest).toHaveBeenCalledWith("stripe_billing:evt_1", "cus_1", paidInvoice);
    expect(add).toHaveBeenCalledWith(SETTLE_STRIPE_BILLING_EVENT_JOB, { eventId: "e-1", tenantId: TENANT }, expect.objectContaining({ jobId: "settle-stripe-e-1" }));
  });

  it("drops unknown customers, unhandled event types and malformed bodies without queueing", async () => {
    const unknown = makeService({ stored: null });
    await expect(unknown.service.ingestEvent(paidInvoice)).resolves.toBe(false);
    expect(unknown.add).not.toHaveBeenCalled();
    const other = makeService();
    await expect(other.service.ingestEvent(eventBody("charge.refunded", { customer: "cus_1" }))).resolves.toBe(false);
    await expect(other.service.ingestEvent({ nope: true })).resolves.toBe(false);
    expect(other.ingest).not.toHaveBeenCalled();
  });

  it("keeps the stored event when the queue is down", async () => {
    const { service } = makeService({ queueFails: true });
    await expect(service.ingestEvent(paidInvoice)).resolves.toBe(true);
  });
});

describe("billingReturnUrl", () => {
  it("builds the billing settings URL", () => {
    expect(billingReturnUrl("https://x.test///")).toBe("https://x.test/app/settings/billing");
    expect(billingReturnUrl("https://x.test", "cancel")).toBe("https://x.test/app/settings/billing?card=cancel");
  });
});

describe("StripeBillingWebhookController", () => {
  const sign = (raw: string, t = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET) =>
    `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
  function setup(secret: string | null = WEBHOOK_SECRET, known = true) {
    const ingestEvent = vi.fn(async () => known);
    const ctrl = new StripeBillingWebhookController({ ingestEvent } as unknown as CardBillingService, secret);
    const reply = { status: 0, code(s: number) { this.status = s; return this; }, send: vi.fn() };
    return { ctrl, reply, ingestEvent };
  }
  const raw = JSON.stringify(paidInvoice);

  it("401 and nothing stored on a missing, wrong or stale signature", async () => {
    const { ctrl, reply, ingestEvent } = setup();
    await ctrl.receive({ rawBody: Buffer.from(raw) }, undefined, reply);
    expect(reply.status).toBe(401);
    await ctrl.receive({ rawBody: Buffer.from(raw) }, sign(raw, undefined, "whsec_wrong"), reply);
    expect(reply.status).toBe(401);
    await ctrl.receive({ rawBody: Buffer.from(raw) }, sign(raw, 1_000_000), reply);
    expect(reply.status).toBe(401);
    // Body tampered after signing.
    await ctrl.receive({ rawBody: Buffer.from(raw.replace("4900", "1")) }, sign(raw), reply);
    expect(reply.status).toBe(401);
    expect(ingestEvent).not.toHaveBeenCalled();
  });

  it("401 when the webhook secret is not configured (feature off)", async () => {
    const { ctrl, reply, ingestEvent } = setup(null);
    await ctrl.receive({ rawBody: Buffer.from(raw) }, sign(raw), reply);
    expect(reply.status).toBe(401);
    expect(ingestEvent).not.toHaveBeenCalled();
  });

  it("persists a verified event and acknowledges unknown ones with 200", async () => {
    const ok = setup();
    await ok.ctrl.receive({ rawBody: Buffer.from(raw) }, sign(raw), ok.reply);
    expect(ok.reply.status).toBe(200);
    expect(ok.ingestEvent).toHaveBeenCalledWith(paidInvoice);
    const unknown = setup(WEBHOOK_SECRET, false);
    await unknown.ctrl.receive({ rawBody: Buffer.from(raw) }, sign(raw), unknown.reply);
    expect(unknown.reply.status).toBe(200);
  });

  it("503 on a transient ingestion failure so Stripe retries, 413 on an oversized payload", async () => {
    const { ctrl, reply, ingestEvent } = setup();
    ingestEvent.mockRejectedValueOnce(new Error("db down"));
    await ctrl.receive({ rawBody: Buffer.from(raw) }, sign(raw), reply);
    expect(reply.status).toBe(503);
    ingestEvent.mockRejectedValueOnce(Object.assign(new Error("big"), { code: "54000" }));
    await ctrl.receive({ rawBody: Buffer.from(raw) }, sign(raw), reply);
    expect(reply.status).toBe(413);
  });
});
