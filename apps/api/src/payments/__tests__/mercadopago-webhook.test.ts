import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CipherBox } from "@crmwsp/crypto";
import { PaymentProviderError, buildExternalReference, type MercadoPagoPayment } from "@crmwsp/payments";
import { MercadoPagoWebhookService, type MercadoPagoProviderFactory, type MercadoPagoWebhookResolver } from "../mercadopago-webhook.service.js";
import type { MarkPaidInput, OrderRecord, PaymentLedger, PaymentLedgerTx, PaymentRecord } from "../payment-ledger.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER = "33333333-3333-4333-8333-333333333333";
const PAYMENT = "44444444-4444-4444-8444-444444444444";
const TOKEN = "b".repeat(43);
const SECRET = "mpwebhooksecret1234567890";
const ACCESS = "APP_USR-1234567890-abcdef";
const NOW_MS = 1_800_000_000_000;
const TS = Math.floor(NOW_MS / 1000);
const REF = buildExternalReference({ tenantId: TENANT, kind: "order", id: ORDER }, "0123456789abcdef");

const fakeCipher = {
  encrypt: (p: string) => Buffer.from(p),
  decrypt: (b: Buffer, ctx: { tenantId: string; purpose: string }) => {
    if (ctx.tenantId !== TENANT || !["mercadopago_webhook_secret", "mercadopago_access_token"].includes(ctx.purpose)) throw new Error("bad AAD");
    return b.toString();
  },
} as unknown as CipherBox;

const resolver: MercadoPagoWebhookResolver = {
  resolve: async (t) => (t === TOKEN ? { tenantId: TENANT, webhookSecretEncrypted: Buffer.from(SECRET), accessTokenEncrypted: Buffer.from(ACCESS) } : null),
};

class FakeLedger implements PaymentLedger {
  events: Array<{ eventId: string; outcome: string }> = [];
  providers: string[] = [];
  payment: PaymentRecord = { id: PAYMENT, orderId: ORDER, amountMinor: 150050n, currency: "ARS", status: "pending" };
  order: OrderRecord = { id: ORDER, status: "pending_payment", fulfillment: "shipping", totalMinor: 150050n, currency: "ARS" };
  paid: MarkPaidInput[] = [];

  async inTenant<T>(_tenantId: string, fn: (tx: PaymentLedgerTx) => Promise<T>, provider?: string): Promise<T> {
    this.providers.push(provider ?? "stripe");
    const self = this;
    return fn({
      async recordEvent(e) {
        if (self.events.some((r) => r.eventId === e.eventId)) return null;
        self.events.push({ eventId: e.eventId, outcome: "processing" });
        return e.eventId;
      },
      async setEventOutcome(id, outcome) {
        const r = self.events.find((x) => x.eventId === id);
        if (r) r.outcome = outcome;
      },
      async lockPaymentByRef(ref) {
        return ref === REF ? { ...self.payment } : null;
      },
      async lockOrder(id) {
        return id === ORDER ? { ...self.order } : null;
      },
      async markOrderPaid(i) {
        self.paid.push(i);
        self.order.status = "paid";
        self.payment.status = "succeeded";
      },
      async setPaymentStatus(_id, status) {
        self.payment.status = status;
      },
    });
  }
}

function setup(apiPayment: Partial<MercadoPagoPayment> | Error = {}) {
  const ledger = new FakeLedger();
  const fetched: string[] = [];
  const tokens: string[] = [];
  const factory: MercadoPagoProviderFactory = (accessToken) => {
    tokens.push(accessToken);
    return {
      async getPaymentById(id: string) {
        fetched.push(id);
        if (apiPayment instanceof Error) throw apiPayment;
        return { id, status: "approved", amountMinor: 150050, currency: "ARS", externalReference: REF, reference: { tenantId: TENANT, kind: "order", id: ORDER }, occurredAt: new Date(NOW_MS), ...apiPayment };
      },
      async createPaymentLink() {
        throw new Error("unused");
      },
    };
  };
  const service = new MercadoPagoWebhookService(resolver, ledger, fakeCipher, () => NOW_MS, factory);
  return { service, ledger, fetched, tokens };
}

function signed(id: string, opts: { ts?: number; secret?: string; requestId?: string } = {}) {
  const ts = opts.ts ?? TS;
  const rid = opts.requestId ?? "req-1";
  const v1 = createHmac("sha256", opts.secret ?? SECRET).update(`id:${id};request-id:${rid};ts:${ts};`).digest("hex");
  return {
    body: new TextEncoder().encode(JSON.stringify({ action: "payment.updated", type: "payment", data: { id } })),
    headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid },
    query: { "data.id": id, type: "payment" },
  };
}

describe("MercadoPagoWebhookService", () => {
  it("valid signature + API-confirmed approved payment marks the order paid (verified_by webhook path)", async () => {
    const { service, ledger, fetched, tokens } = setup();
    const r = signed("123456");
    const out = await service.handle(TOKEN, r.body, r.headers, r.query);
    expect(out).toEqual({ kind: "processed", outcome: "applied" });
    expect(fetched).toEqual(["123456"]);
    expect(tokens).toEqual([ACCESS]);
    expect(ledger.providers).toEqual(["mercadopago"]);
    expect(ledger.paid).toHaveLength(1);
    expect(ledger.paid[0]).toMatchObject({ orderId: ORDER, amountMinor: 150050n, currency: "ARS", eventId: "mp:123456:approved" });
  });

  it("rejects an invalid signature without calling the MP API", async () => {
    const { service, ledger, fetched } = setup();
    const r = signed("123456", { secret: "wrong-secret-value" });
    expect(await service.handle(TOKEN, r.body, r.headers, r.query)).toEqual({ kind: "invalid-signature" });
    expect(fetched).toEqual([]);
    expect(ledger.paid).toHaveLength(0);
  });

  it("rejects a stale (replayed) signature and dedupes a replay within the window", async () => {
    const { service, ledger, fetched } = setup();
    const stale = signed("123456", { ts: TS - 3600 });
    expect(await service.handle(TOKEN, stale.body, stale.headers, stale.query)).toEqual({ kind: "invalid-signature" });
    expect(fetched).toEqual([]);
    const r = signed("123456");
    await service.handle(TOKEN, r.body, r.headers, r.query);
    expect(await service.handle(TOKEN, r.body, r.headers, r.query)).toEqual({ kind: "processed", outcome: "duplicate" });
    expect(ledger.paid).toHaveLength(1);
  });

  it("never trusts the payload: API says pending -> not paid", async () => {
    const { service, ledger } = setup({ status: "pending" });
    const r = signed("123456");
    expect(await service.handle(TOKEN, r.body, r.headers, r.query)).toEqual({ kind: "processed", outcome: "ignored" });
    expect(ledger.paid).toHaveLength(0);
  });

  it("amount mismatch from the API is recorded and not paid", async () => {
    const { service, ledger } = setup({ amountMinor: 100 });
    const r = signed("123456");
    expect(await service.handle(TOKEN, r.body, r.headers, r.query)).toEqual({ kind: "processed", outcome: "amount_mismatch" });
    expect(ledger.paid).toHaveLength(0);
  });

  it("unknown token is 401-class; transient API errors bubble up for a retry", async () => {
    const { service } = setup(new PaymentProviderError("mercadopago", "down", true, { status: 503 }));
    const r = signed("123456");
    expect(await service.handle("c".repeat(43), r.body, r.headers, r.query)).toEqual({ kind: "unknown-token" });
    await expect(service.handle(TOKEN, r.body, r.headers, r.query)).rejects.toThrow();
  });
});
