import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CommercePayloadError,
  InvalidSignatureError,
  decideExternalSale,
  decimalToMinor,
  eduzzConnector,
  gumroadConnector,
  hotmartConnector,
  kiwifyConnector,
  payhipConnector,
  shopifyConnector,
  type FetchLike,
} from "../index.js";

const enc = (s: string) => new TextEncoder().encode(s);
const SECRET = "shpss_test_secret_123";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";

const shopifyOrder = JSON.stringify({
  id: 5678901234567,
  total_price: "49.90",
  currency: "EUR",
  email: "ana@example.com",
  phone: "+34600111222",
  customer: { first_name: "Ana", last_name: "Pérez" },
  line_items: [{ product_id: 632910392, title: "Curso" }],
  note_attributes: [{ name: "crmwsp_order_id", value: ORDER_ID }],
  financial_status: "paid",
  processed_at: "2026-10-01T10:00:00Z",
});
const shopifySig = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("base64");
const shopifyHeaders = (body: string, topic = "orders/paid", secret = SECRET) => ({
  "X-Shopify-Hmac-Sha256": shopifySig(body, secret),
  "x-shopify-topic": topic,
  "x-shopify-webhook-id": "b54557e4-bdd9-4b37-8a5f-bf7d70bcd043",
});

describe("decimalToMinor", () => {
  it("is exact and rejects ambiguity", () => {
    expect(decimalToMinor("49.90", "EUR")).toBe(4990);
    expect(decimalToMinor(49.9, "EUR")).toBe(4990);
    expect(decimalToMinor("1000", "CLP")).toBe(1000);
    expect(decimalToMinor("1.5", "CLP")).toBeNull();
    expect(decimalToMinor("1.234", "KWD")).toBe(1234);
    expect(decimalToMinor("1e3", "EUR")).toBeNull();
    expect(decimalToMinor("-1", "EUR")).toBeNull();
    expect(decimalToMinor("1.001", "EUR")).toBeNull();
    expect(decimalToMinor("10", null)).toBeNull();
  });
});

describe("Shopify", () => {
  it("accepts a valid signature and normalizes orders/paid", () => {
    const ev = shopifyConnector.verifyWebhook(enc(shopifyOrder), shopifyHeaders(shopifyOrder), SECRET);
    expect(ev).toMatchObject({ type: "order_paid", verification: "hmac_body", schemeConfirmed: true, eventId: "wh:b54557e4-bdd9-4b37-8a5f-bf7d70bcd043" });
    expect(ev.sale).toMatchObject({
      externalId: "5678901234567",
      status: "approved",
      amountMinor: 4990,
      currency: "EUR",
      buyer: { email: "ana@example.com", phone: "+34600111222", name: "Ana Pérez" },
      crmwspOrderId: ORDER_ID,
      productRef: "632910392",
    });
  });
  it("rejects a tampered body", () => {
    const tampered = shopifyOrder.replace("49.90", "0.01");
    expect(() => shopifyConnector.verifyWebhook(enc(tampered), shopifyHeaders(shopifyOrder), SECRET)).toThrow(InvalidSignatureError);
  });
  it("rejects a wrong secret and a missing header", () => {
    expect(() => shopifyConnector.verifyWebhook(enc(shopifyOrder), shopifyHeaders(shopifyOrder, "orders/paid", "other"), SECRET)).toThrow(InvalidSignatureError);
    expect(() => shopifyConnector.verifyWebhook(enc(shopifyOrder), { "x-shopify-topic": "orders/paid" }, SECRET)).toThrow(InvalidSignatureError);
  });
  it("normalizes refunds and ignores unknown topics", () => {
    const refund = JSON.stringify({ id: 1, order_id: 5678901234567, transactions: [{ kind: "refund", status: "success", amount: "10.00", currency: "EUR" }] });
    const ev = shopifyConnector.verifyWebhook(enc(refund), shopifyHeaders(refund, "refunds/create"), SECRET);
    expect(ev.sale).toMatchObject({ externalId: "5678901234567", status: "refunded", amountMinor: 1000 });
    const other = JSON.stringify({ id: 5 });
    expect(shopifyConnector.verifyWebhook(enc(other), shopifyHeaders(other, "carts/update"), SECRET).type).toBe("ignored");
  });
  it("normalizes products/update with variant options", () => {
    const p = JSON.stringify({
      id: 77,
      title: "Camiseta",
      status: "active",
      options: [{ name: "Talla" }],
      variants: [
        { id: 1, sku: "TS-M", price: "19.99", option1: "M" },
        { id: 2, sku: "TS-L", price: "21.00", compare_at_price: "25.00", option1: "L" },
      ],
    });
    const ev = shopifyConnector.verifyWebhook(enc(p), shopifyHeaders(p, "products/update"), SECRET, { currency: "EUR" });
    expect(ev.type).toBe("product_updated");
    expect(ev.product).toMatchObject({ externalId: "77", priceMinor: 1999, variants: [{ externalId: "1", options: { Talla: "M" } }, { compareAtMinor: 2500 }] });
  });
  it("paginates the catalog and refuses off-shop pagination links", async () => {
    const calls: string[] = [];
    const root = "https://demo.myshopify.com/admin/api/2024-10";
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      const body = url.endsWith("/shop.json")
        ? { shop: { currency: "USD" } }
        : { products: [{ id: calls.length, title: `P${calls.length}`, variants: [{ id: 10 + calls.length, price: "5.00" }] }] };
      const link = url.includes("page_info") ? null : `<${root}/products.json?limit=250&page_info=abc>; rel="next"`;
      return { ok: true, status: 200, headers: { get: (n: string) => (n === "link" ? link : null) }, json: async () => body };
    };
    const page = await shopifyConnector.listProducts!({ shopDomain: "demo.myshopify.com", accessToken: "shpat_x" }, fetchImpl);
    expect(page.currency).toBe("USD");
    expect(page.products).toHaveLength(2);
    await expect(shopifyConnector.listProducts!({ shopDomain: "evil.com", accessToken: "x" }, fetchImpl)).rejects.toThrow(CommercePayloadError);
    const evil: FetchLike = async (url) => ({
      ok: true,
      status: 200,
      headers: { get: () => '<https://evil.example/steal>; rel="next"' },
      json: async () => (url.endsWith("/shop.json") ? { shop: { currency: "USD" } } : { products: [] }),
    });
    await expect(shopifyConnector.listProducts!({ shopDomain: "demo.myshopify.com", accessToken: "x" }, evil)).rejects.toThrow(CommercePayloadError);
  });
});

describe("Hotmart", () => {
  const body = JSON.stringify({
    id: "evt-1",
    event: "PURCHASE_APPROVED",
    data: {
      product: { id: 9, name: "Ebook" },
      buyer: { email: "b@x.com", name: "Bea", checkout_phone: "5511999999999" },
      purchase: { transaction: "HP123", price: { value: 97.5, currency_value: "BRL" } },
    },
  });
  it("accepts the hottok and normalizes", () => {
    const ev = hotmartConnector.verifyWebhook(enc(body), { "X-HOTMART-HOTTOK": "hot-secret" }, "hot-secret");
    expect(ev).toMatchObject({ type: "purchase_approved", verification: "shared_token", eventId: "PURCHASE_APPROVED:HP123" });
    expect(ev.sale).toMatchObject({ externalId: "HP123", amountMinor: 9750, currency: "BRL", buyer: { phone: "5511999999999" } });
  });
  it("rejects a wrong hottok", () => {
    expect(() => hotmartConnector.verifyWebhook(enc(body), { "x-hotmart-hottok": "nope" }, "hot-secret")).toThrow(InvalidSignatureError);
    expect(() => hotmartConnector.verifyWebhook(enc(body), {}, "hot-secret")).toThrow(InvalidSignatureError);
  });
  it("maps refunds", () => {
    const r = body.replace("PURCHASE_APPROVED", "PURCHASE_REFUNDED");
    expect(hotmartConnector.verifyWebhook(enc(r), { "x-hotmart-hottok": "hot-secret" }, "hot-secret").type).toBe("purchase_refunded");
  });
});

describe("Kiwify", () => {
  const body = JSON.stringify({
    order_id: "kw-1",
    order_status: "paid",
    webhook_event_type: "order_approved",
    Customer: { email: "c@x.com", mobile: "+5511988887777", full_name: "Caio" },
    Product: { product_id: "p1", product_name: "Curso" },
    Commissions: { charge_amount: 19700, currency: "BRL" },
  });
  const sig = (b: string, s = "kiwi-token") => createHmac("sha1", s).update(b).digest("hex");
  it("accepts a valid query signature", () => {
    const ev = kiwifyConnector.verifyWebhook(enc(body), {}, "kiwi-token", { query: { signature: sig(body) } });
    expect(ev).toMatchObject({ type: "purchase_approved", schemeConfirmed: false });
    expect(ev.sale).toMatchObject({ externalId: "kw-1", amountMinor: 19700, currency: "BRL" });
  });
  it("rejects tampered body and wrong secret", () => {
    expect(() => kiwifyConnector.verifyWebhook(enc(body.replace("19700", "1")), {}, "kiwi-token", { query: { signature: sig(body) } })).toThrow(InvalidSignatureError);
    expect(() => kiwifyConnector.verifyWebhook(enc(body), {}, "kiwi-token", { query: { signature: sig(body, "x") } })).toThrow(InvalidSignatureError);
    expect(() => kiwifyConnector.verifyWebhook(enc(body), {}, "kiwi-token")).toThrow(InvalidSignatureError);
  });
});

describe("Eduzz", () => {
  const body = JSON.stringify({ id: "ed-evt", event: "myeduzz.invoice_paid", data: { id: "inv-9", price: { value: "150.00", currency: "BRL" }, buyer: { email: "d@x.com", cellphone: "5521977776666" } } });
  const sig = (b: string, s = "edz") => createHmac("sha256", s).update(b).digest("hex");
  it("accepts a valid signature", () => {
    const ev = eduzzConnector.verifyWebhook(enc(body), { "x-signature": sig(body) }, "edz");
    expect(ev.sale).toMatchObject({ externalId: "inv-9", status: "approved", amountMinor: 15000 });
  });
  it("rejects tampered body and wrong secret", () => {
    expect(() => eduzzConnector.verifyWebhook(enc(body.replace("150.00", "1.00")), { "x-signature": sig(body) }, "edz")).toThrow(InvalidSignatureError);
    expect(() => eduzzConnector.verifyWebhook(enc(body), { "x-signature": sig(body, "no") }, "edz")).toThrow(InvalidSignatureError);
  });
});

describe("Gumroad", () => {
  const form = "seller_id=seller123&sale_id=s-1&price=990&currency=usd&email=e%40x.com&product_id=pp&product_name=Pack&refunded=false";
  it("accepts a matching seller id and normalizes", () => {
    const ev = gumroadConnector.verifyWebhook(enc(form), {}, "seller123");
    expect(ev).toMatchObject({ type: "purchase_approved", eventId: "s-1:approved", verification: "shared_token" });
    expect(ev.sale).toMatchObject({ amountMinor: 990, currency: "USD", buyer: { email: "e@x.com" } });
  });
  it("rejects a wrong seller id and distinguishes refunds", () => {
    expect(() => gumroadConnector.verifyWebhook(enc(form), {}, "other")).toThrow(InvalidSignatureError);
    const ev = gumroadConnector.verifyWebhook(enc(form.replace("refunded=false", "refunded=true")), {}, "seller123");
    expect(ev).toMatchObject({ type: "purchase_refunded", eventId: "s-1:refunded" });
  });
});

describe("Payhip", () => {
  const key = "payhip-api-key";
  const body = (sig: string) => JSON.stringify({ id: "ph-1", type: "paid", email: "f@x.com", price: 1500, currency: "EUR", signature: sig, items: [{ product_id: "x", product_name: "Plantilla" }] });
  const good = createHash("sha256").update(key).digest("hex");
  it("accepts the sha256(api key) signature", () => {
    const ev = payhipConnector.verifyWebhook(enc(body(good)), {}, key);
    expect(ev.sale).toMatchObject({ externalId: "ph-1", amountMinor: 1500, currency: "EUR" });
  });
  it("rejects a wrong signature", () => {
    expect(() => payhipConnector.verifyWebhook(enc(body("0".repeat(64))), {}, key)).toThrow(InvalidSignatureError);
    expect(() => payhipConnector.verifyWebhook(enc(body(good)), {}, "other-key")).toThrow(InvalidSignatureError);
  });
});

describe("weak webhook auth (CN-016)", () => {
  it("flags the static/semi-public token schemes as weakAuth, and only those", () => {
    expect(gumroadConnector.weakAuth).toBe(true);
    expect(hotmartConnector.weakAuth).toBe(true);
    expect(payhipConnector.weakAuth).toBe(true);
    expect(shopifyConnector.weakAuth ?? false).toBe(false);
    expect(kiwifyConnector.weakAuth ?? false).toBe(false);
    expect(eduzzConnector.weakAuth ?? false).toBe(false);
  });

  it("Hotmart dedupes by sale (event + transaction), not by the replayable envelope id", () => {
    const mk = (id: string) =>
      JSON.stringify({ id, event: "PURCHASE_APPROVED", data: { purchase: { transaction: "HP9", price: { value: 1, currency_value: "BRL" } } } });
    const a = hotmartConnector.verifyWebhook(enc(mk("evt-a")), { "x-hotmart-hottok": "t" }, "t");
    const b = hotmartConnector.verifyWebhook(enc(mk("evt-b")), { "x-hotmart-hottok": "t" }, "t");
    expect(a.eventId).toBe(b.eventId);
  });

  it("Payhip and Gumroad event ids are bound to the sale id", () => {
    const key = "k";
    const sig = createHash("sha256").update(key).digest("hex");
    const ev = payhipConnector.verifyWebhook(enc(JSON.stringify({ id: "ph-7", type: "paid", signature: sig })), {}, key);
    expect(ev.eventId).toBe("paid:ph-7");
    expect(gumroadConnector.verifyWebhook(enc("seller_id=s&sale_id=g-7"), {}, "s").eventId).toBe("g-7:approved");
  });
});

describe("decideExternalSale (order trust gate)", () => {
  const order = { id: ORDER_ID, totalMinor: 4990n, currency: "EUR" };
  const signed = () => shopifyConnector.verifyWebhook(enc(shopifyOrder), shopifyHeaders(shopifyOrder), SECRET);
  it("links only signed, confirmed, approved, matching sales", () => {
    expect(decideExternalSale(signed(), order)).toEqual({ link: true, orderId: ORDER_ID });
  });
  it("refuses amount and currency mismatches", () => {
    expect(decideExternalSale(signed(), { ...order, totalMinor: 5000n })).toEqual({ link: false, reason: "amount_mismatch" });
    expect(decideExternalSale(signed(), { ...order, currency: "USD" })).toEqual({ link: false, reason: "currency_mismatch" });
    expect(decideExternalSale(signed(), null)).toEqual({ link: false, reason: "unknown_order" });
  });
  it("never links shared-token or unconfirmed schemes even with an order id", () => {
    const ev = signed();
    expect(decideExternalSale({ ...ev, verification: "shared_token" }, order)).toEqual({ link: false, reason: "not_body_signed" });
    expect(decideExternalSale({ ...ev, schemeConfirmed: false }, order)).toEqual({ link: false, reason: "scheme_unconfirmed" });
    expect(decideExternalSale({ ...ev, sale: { ...ev.sale!, status: "refunded" } }, order)).toEqual({ link: false, reason: "not_approved" });
  });
});
