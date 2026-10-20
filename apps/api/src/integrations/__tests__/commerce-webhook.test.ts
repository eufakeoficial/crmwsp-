import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CipherBox } from "@crmwsp/crypto";
import type { CommerceProvider, OrderSnapshot } from "@crmwsp/integrations";
import { phoneToE164, type CommerceLedger, type CommerceLedgerTx, type ExternalSaleUpsert } from "../commerce-ledger.js";
import { CommerceWebhookService, type CommerceWebhookResolver } from "../commerce-webhook.service.js";
import { optionKeyOf } from "../pg-commerce-ledger.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER = "33333333-3333-4333-8333-333333333333";
const CONTACT = "55555555-5555-4555-8555-555555555555";
const TOKEN = "a".repeat(43);
const SECRET = "shpss_secret_value";

const fakeCipher = {
  decrypt: (b: Buffer, ctx: { tenantId: string; purpose: string }) => {
    if (ctx.tenantId !== TENANT || !ctx.purpose.startsWith("commerce_webhook_secret:")) throw new Error("bad AAD");
    return b.toString();
  },
} as unknown as CipherBox;

const resolver: CommerceWebhookResolver = {
  resolve: async (provider, token) => (token === TOKEN && provider === "shopify" ? { tenantId: TENANT, webhookSecretEncrypted: Buffer.from(SECRET), shopCurrency: "EUR" } : null),
};

/** In-memory ledger: dedupe on (tenant, provider, event id), all-or-nothing on throw. */
class FakeLedger implements CommerceLedger {
  events: Array<{ provider: CommerceProvider; eventId: string; outcome: string }> = [];
  sales: ExternalSaleUpsert[] = [];
  order: OrderSnapshot = { id: ORDER, totalMinor: 4990n, currency: "EUR" };
  catalog = 0;
  failNext = false;

  async inTenant<T>(_tenantId: string, fn: (tx: CommerceLedgerTx) => Promise<T>): Promise<T> {
    const snap = { e: [...this.events], s: [...this.sales] };
    const self = this;
    const tx: CommerceLedgerTx = {
      async recordEvent(e) {
        if (self.events.some((r) => r.provider === e.provider && r.eventId === e.eventId)) return null;
        self.events.push({ provider: e.provider, eventId: e.eventId, outcome: "processing" });
        return e.eventId;
      },
      async setEventOutcome(id, outcome) {
        const r = self.events.find((x) => x.eventId === id);
        if (r) r.outcome = outcome;
      },
      async findContact(phone) {
        return phone === "+34600111222" ? CONTACT : null;
      },
      async findOrder(id) {
        return id === ORDER ? self.order : null;
      },
      async upsertExternalSale(s) {
        if (self.failNext) throw new Error("db down");
        self.sales.push(s);
        return "sale-1";
      },
      async upsertCatalog(_s, _c, list) {
        self.catalog += list.length;
        return { products: list.length, variants: 0 };
      },
    };
    try {
      return await fn(tx);
    } catch (err) {
      this.events = snap.e;
      this.sales = snap.s;
      throw err;
    }
  }
}

const order = (total = "49.90") =>
  JSON.stringify({
    id: 5678901234567,
    total_price: total,
    currency: "EUR",
    phone: "+34 600 111 222",
    note_attributes: [{ name: "crmwsp_order_id", value: ORDER }],
  });
const headers = (body: string, id = "wh-1", secret = SECRET) => ({
  "x-shopify-hmac-sha256": createHmac("sha256", secret).update(body).digest("base64"),
  "x-shopify-topic": "orders/paid",
  "x-shopify-webhook-id": id,
});
const enc = (s: string) => new TextEncoder().encode(s);

function setup() {
  const ledger = new FakeLedger();
  return { ledger, svc: new CommerceWebhookService(resolver, ledger, fakeCipher) };
}

describe("CommerceWebhookService", () => {
  it("records a verified sale, matches the contact and links the order on exact amount", async () => {
    const { ledger, svc } = setup();
    const b = order();
    const out = await svc.handle("shopify", TOKEN, enc(b), headers(b), {});
    expect(out).toEqual({ kind: "processed", outcome: "recorded:order_linked" });
    expect(ledger.sales[0]).toMatchObject({ contactId: CONTACT, orderId: ORDER, amountMinor: 4990, buyerPhoneE164: "+34600111222" });
  });
  it("records but does not link on amount mismatch", async () => {
    const { ledger, svc } = setup();
    const b = order("1.00");
    const out = await svc.handle("shopify", TOKEN, enc(b), headers(b), {});
    expect(out).toEqual({ kind: "processed", outcome: "recorded:amount_mismatch" });
    expect(ledger.sales[0]?.orderId).toBeNull();
  });
  it("deduplicates replays by delivery id", async () => {
    const { ledger, svc } = setup();
    const b = order();
    await svc.handle("shopify", TOKEN, enc(b), headers(b), {});
    expect(await svc.handle("shopify", TOKEN, enc(b), headers(b), {})).toEqual({ kind: "processed", outcome: "duplicate" });
    expect(ledger.sales).toHaveLength(1);
  });
  it("rejects tampered bodies, wrong secrets and unknown tokens without writing", async () => {
    const { ledger, svc } = setup();
    const b = order();
    expect(await svc.handle("shopify", TOKEN, enc(order("0.01")), headers(b), {})).toEqual({ kind: "invalid-signature" });
    expect(await svc.handle("shopify", TOKEN, enc(b), headers(b, "x", "other"), {})).toEqual({ kind: "invalid-signature" });
    expect(await svc.handle("shopify", "b".repeat(43), enc(b), headers(b), {})).toEqual({ kind: "unknown-token" });
    expect(await svc.handle("hotmart", TOKEN, enc(b), headers(b), {})).toEqual({ kind: "unknown-token" });
    expect(ledger.events).toHaveLength(0);
  });
  it("rolls back the dedupe row when applying fails, so the retry re-applies", async () => {
    const { ledger, svc } = setup();
    const b = order();
    ledger.failNext = true;
    await expect(svc.handle("shopify", TOKEN, enc(b), headers(b), {})).rejects.toThrow("db down");
    expect(ledger.events).toHaveLength(0);
    ledger.failNext = false;
    expect((await svc.handle("shopify", TOKEN, enc(b), headers(b), {})).kind).toBe("processed");
  });
});

describe("helpers", () => {
  it("normalizes phones and option keys", () => {
    expect(phoneToE164("+55 (11) 98888-7777")).toBe("+5511988887777");
    expect(phoneToE164("0123")).toBeNull();
    expect(optionKeyOf({ Talla: "M", Color: "Negro" })).toBe("color=negro|talla=m");
    expect(optionKeyOf({})).toBe("");
  });
});
