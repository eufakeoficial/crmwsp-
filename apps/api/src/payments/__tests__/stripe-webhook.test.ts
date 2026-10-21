import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CipherBox } from "@crmwsp/crypto";
import type {
  MarkPaidInput,
  OrderRecord,
  PaymentEventOutcome,
  PaymentLedger,
  PaymentLedgerTx,
  PaymentRecord,
} from "../payment-ledger.js";
import { StripeWebhookService, type StripeWebhookResolver } from "../stripe-webhook.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const PAYMENT = "44444444-4444-4444-8444-444444444444";
const TOKEN = "a".repeat(43);
const SECRET = "whsec_testsecret123456";
const NOW_MS = 1_800_000_000_000;

/** Identity "cipher": the ciphertext is the plaintext; checks the AAD the service asks for. */
const fakeCipher = {
  encrypt: (p: string) => Buffer.from(p),
  decrypt: (b: Buffer, ctx: { tenantId: string; purpose: string }) => {
    if (ctx.tenantId !== TENANT || ctx.purpose !== "stripe_webhook_secret") throw new Error("bad AAD");
    return b.toString();
  },
  rotate: (b: Buffer) => b,
  needsRotation: () => false,
} as unknown as CipherBox;

const resolver: StripeWebhookResolver = {
  resolve: async (token) => (token === TOKEN ? { tenantId: TENANT, webhookSecretEncrypted: Buffer.from(SECRET) } : null),
};

interface EventRow {
  tenantId: string;
  eventId: string;
  outcome: string;
  paymentId: string | null;
}

/**
 * In-memory ledger with the same transactional contract as PgPaymentLedger: dedupe on
 * (tenant, event id) and all-or-nothing (a throw restores the snapshot).
 */
class FakeLedger implements PaymentLedger {
  events: EventRow[] = [];
  payment: PaymentRecord = { id: PAYMENT, orderId: ORDER, amountMinor: 4990n, currency: "EUR", status: "pending" };
  order: OrderRecord = { id: ORDER, status: "pending_payment", fulfillment: "shipping", totalMinor: 4990n, currency: "EUR" };
  paidCalls: MarkPaidInput[] = [];
  stockCommits = 0;

  async inTenant<T>(tenantId: string, fn: (tx: PaymentLedgerTx) => Promise<T>): Promise<T> {
    const snap = JSON.stringify({ e: this.events, p: { ...this.payment, amountMinor: String(this.payment.amountMinor) } });
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- fake tx closes over the fixture
    const self = this;
    const tx: PaymentLedgerTx = {
      async recordEvent(e) {
        if (self.events.some((r) => r.tenantId === tenantId && r.eventId === e.eventId)) return null;
        self.events.push({ tenantId, eventId: e.eventId, outcome: "processing", paymentId: null });
        return e.eventId;
      },
      async setEventOutcome(id: string, outcome: PaymentEventOutcome, paymentId: string | null) {
        const r = self.events.find((x) => x.tenantId === tenantId && x.eventId === id);
        if (r) Object.assign(r, { outcome, paymentId });
      },
      async lockPaymentByRef(ref) {
        return tenantId === TENANT && ref === "cs_test_1" ? { ...self.payment } : null;
      },
      async lockOrder(id) {
        return tenantId === TENANT && id === ORDER ? { ...self.order } : null;
      },
      async markOrderPaid(i) {
        self.stockCommits += 1;
        self.paidCalls.push(i);
        self.order.status = "paid";
        self.payment.status = "succeeded";
      },
      async setPaymentStatus(_id, status) {
        self.payment.status = status;
      },
    };
    try {
      return await fn(tx);
    } catch (err) {
      const s = JSON.parse(snap) as { e: EventRow[]; p: PaymentRecord & { amountMinor: string } };
      this.events = s.e;
      this.payment = { ...s.p, amountMinor: BigInt(s.p.amountMinor) };
      throw err;
    }
  }
}

function sessionEvent(over: { id?: string; type?: string; amount?: number; currency?: string; tenantId?: string; paymentStatus?: string } = {}) {
  return {
    id: over.id ?? "evt_1",
    type: over.type ?? "checkout.session.completed",
    created: Math.floor(NOW_MS / 1000),
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        amount_total: over.amount ?? 4990,
        currency: over.currency ?? "eur",
        payment_status: over.paymentStatus ?? "paid",
        status: "complete",
        payment_intent: "pi_1",
        metadata: { tenantId: over.tenantId ?? TENANT, kind: "order", id: ORDER },
      },
    },
  };
}

function signed(body: unknown, secret = SECRET, tsSec = Math.floor(NOW_MS / 1000)) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = createHmac("sha256", secret).update(`${tsSec}.`).update(raw).digest("hex");
  return { raw, headers: { "stripe-signature": `t=${tsSec},v1=${sig}` } };
}

function setup() {
  const ledger = new FakeLedger();
  const service = new StripeWebhookService(resolver, ledger, fakeCipher, () => NOW_MS);
  return { ledger, service };
}

describe("StripeWebhookService", () => {
  it("happy path: verified, matching event moves pending_payment -> paid once", async () => {
    const { ledger, service } = setup();
    const { raw, headers } = signed(sessionEvent());
    const out = await service.handle(TOKEN, raw, headers);
    expect(out).toEqual({ kind: "processed", outcomes: ["applied"] });
    expect(ledger.order.status).toBe("paid");
    expect(ledger.payment.status).toBe("succeeded");
    expect(ledger.paidCalls).toHaveLength(1);
    expect(ledger.paidCalls[0]).toMatchObject({ orderId: ORDER, paymentId: PAYMENT, fromStatus: "pending_payment", amountMinor: 4990n, eventId: "evt_1" });
    expect(ledger.events).toEqual([{ tenantId: TENANT, eventId: "evt_1", outcome: "applied", paymentId: PAYMENT }]);
  });

  it("rejects a bad signature without recording or applying anything", async () => {
    const { ledger, service } = setup();
    const { raw, headers } = signed(sessionEvent(), "whsec_wrongsecret999");
    expect(await service.handle(TOKEN, raw, headers)).toEqual({ kind: "invalid-signature" });
    expect(ledger.events).toHaveLength(0);
    expect(ledger.order.status).toBe("pending_payment");
  });

  it("rejects a tampered body (signature over different bytes)", async () => {
    const { ledger, service } = setup();
    const { headers } = signed(sessionEvent());
    const tampered = Buffer.from(JSON.stringify(sessionEvent({ amount: 1 })));
    expect(await service.handle(TOKEN, tampered, headers)).toEqual({ kind: "invalid-signature" });
    expect(ledger.events).toHaveLength(0);
  });

  it("rejects a stale timestamp (replay outside tolerance)", async () => {
    const { ledger, service } = setup();
    const { raw, headers } = signed(sessionEvent(), SECRET, Math.floor(NOW_MS / 1000) - 3600);
    expect(await service.handle(TOKEN, raw, headers)).toEqual({ kind: "invalid-signature" });
    expect(ledger.events).toHaveLength(0);
  });

  it("missing signature header is rejected", async () => {
    const { service } = setup();
    const raw = Buffer.from(JSON.stringify(sessionEvent()));
    expect(await service.handle(TOKEN, raw, {})).toEqual({ kind: "invalid-signature" });
  });

  it("unknown token is reported before any crypto", async () => {
    const { service } = setup();
    const { raw, headers } = signed(sessionEvent());
    expect(await service.handle("b".repeat(43), raw, headers)).toEqual({ kind: "unknown-token" });
  });

  it("duplicate event id is a no-op (stock committed once)", async () => {
    const { ledger, service } = setup();
    const { raw, headers } = signed(sessionEvent());
    await service.handle(TOKEN, raw, headers);
    const again = await service.handle(TOKEN, raw, headers);
    expect(again).toEqual({ kind: "processed", outcomes: ["duplicate"] });
    expect(ledger.paidCalls).toHaveLength(1);
    expect(ledger.stockCommits).toBe(1);
    expect(ledger.events).toHaveLength(1);
  });

  it("a second distinct success event for an already-paid payment does not re-apply", async () => {
    const { ledger, service } = setup();
    await service.handle(TOKEN, signed(sessionEvent()).raw, signed(sessionEvent()).headers);
    const ev2 = sessionEvent({ id: "evt_2", type: "checkout.session.async_payment_succeeded" });
    const s2 = signed(ev2);
    expect(await service.handle(TOKEN, s2.raw, s2.headers)).toEqual({ kind: "processed", outcomes: ["already_paid"] });
    expect(ledger.paidCalls).toHaveLength(1);
  });

  it("amount mismatch is recorded and ignored (order stays pending_payment)", async () => {
    const { ledger, service } = setup();
    const { raw, headers } = signed(sessionEvent({ amount: 100 }));
    expect(await service.handle(TOKEN, raw, headers)).toEqual({ kind: "processed", outcomes: ["amount_mismatch"] });
    expect(ledger.order.status).toBe("pending_payment");
    expect(ledger.paidCalls).toHaveLength(0);
    expect(ledger.events[0]).toMatchObject({ eventId: "evt_1", outcome: "amount_mismatch", paymentId: PAYMENT });
  });

  it("order total changed after the link (payment snapshot != order total) is a mismatch", async () => {
    const { ledger, service } = setup();
    ledger.order.totalMinor = 5990n;
    const { raw, headers } = signed(sessionEvent());
    expect(await service.handle(TOKEN, raw, headers)).toEqual({ kind: "processed", outcomes: ["amount_mismatch"] });
    expect(ledger.paidCalls).toHaveLength(0);
  });

  it("currency mismatch is recorded and ignored", async () => {
    const { ledger, service } = setup();
    const { raw, headers } = signed(sessionEvent({ currency: "usd" }));
    expect(await service.handle(TOKEN, raw, headers)).toEqual({ kind: "processed", outcomes: ["currency_mismatch"] });
    expect(ledger.paidCalls).toHaveLength(0);
  });

  it("metadata pointing at another tenant is recorded and ignored", async () => {
    const { ledger, service } = setup();
    const { raw, headers } = signed(sessionEvent({ tenantId: OTHER_TENANT }));
    expect(await service.handle(TOKEN, raw, headers)).toEqual({ kind: "processed", outcomes: ["reference_mismatch"] });
    expect(ledger.paidCalls).toHaveLength(0);
  });

  it("paid event for a cancelled order is recorded, never re-opens it", async () => {
    const { ledger, service } = setup();
    ledger.order.status = "cancelled";
    const { raw, headers } = signed(sessionEvent());
    expect(await service.handle(TOKEN, raw, headers)).toEqual({ kind: "processed", outcomes: ["invalid_order_state"] });
    expect(ledger.order.status).toBe("cancelled");
    expect(ledger.paidCalls).toHaveLength(0);
  });

  it("unpaid completed session (delayed method) and unknown types are recorded as ignored", async () => {
    const { ledger, service } = setup();
    const a = signed(sessionEvent({ paymentStatus: "unpaid" }));
    const b = signed({ id: "evt_9", type: "customer.created", created: 1, data: { object: {} } });
    expect(await service.handle(TOKEN, a.raw, a.headers)).toEqual({ kind: "processed", outcomes: ["ignored"] });
    expect(await service.handle(TOKEN, b.raw, b.headers)).toEqual({ kind: "processed", outcomes: ["ignored"] });
    expect(ledger.order.status).toBe("pending_payment");
    expect(ledger.events.map((e) => e.outcome)).toEqual(["ignored", "ignored"]);
  });

  it("expired session marks the payment expired but leaves the order pending", async () => {
    const { ledger, service } = setup();
    const { raw, headers } = signed(sessionEvent({ type: "checkout.session.expired", paymentStatus: "unpaid" }));
    expect(await service.handle(TOKEN, raw, headers)).toEqual({ kind: "processed", outcomes: ["payment_expired"] });
    expect(ledger.payment.status).toBe("expired");
    expect(ledger.order.status).toBe("pending_payment");
  });

  it("a failure while applying rolls back the dedupe row so a retry re-applies", async () => {
    const { ledger, service } = setup();
    const original = ledger.inTenant.bind(ledger);
    let fail = true;
    ledger.inTenant = (tenantId, fn) =>
      original(tenantId, (tx) =>
        fn({
          ...tx,
          markOrderPaid: async (i) => {
            if (fail) throw new Error("db down");
            return tx.markOrderPaid(i);
          },
        }),
      );
    const { raw, headers } = signed(sessionEvent());
    await expect(service.handle(TOKEN, raw, headers)).rejects.toThrow("db down");
    expect(ledger.events).toHaveLength(0);
    fail = false;
    expect(await service.handle(TOKEN, raw, headers)).toEqual({ kind: "processed", outcomes: ["applied"] });
    expect(ledger.order.status).toBe("paid");
  });
});
