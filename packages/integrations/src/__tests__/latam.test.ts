import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidSignatureError, decideExternalSale, normalizeWooSiteUrl, tiendanubeConnector, woocommerceConnector, type FetchLike } from "../index.js";

const enc = (s: string) => new TextEncoder().encode(s);
const SECRET = "latam_webhook_secret_123";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";

function fakeFetch(routes: Record<string, { body: unknown; status?: number; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = routes[url];
    return {
      ok: r !== undefined && (r.status ?? 200) < 400,
      status: r ? (r.status ?? 200) : 404,
      headers: { get: (n: string) => r?.headers?.[n.toLowerCase()] ?? null },
      json: async () => r?.body,
    };
  };
  return { f, calls };
}

describe("Tiendanube", () => {
  const body = JSON.stringify({ store_id: 123456, event: "order/paid", id: 987 });
  const hex = (b: string, s = SECRET) => createHmac("sha256", s).update(b).digest("hex");

  it("accepts a valid x-linkedstore-hmac-sha256 and records the sale without amount", () => {
    const ev = tiendanubeConnector.verifyWebhook(enc(body), { "x-linkedstore-hmac-sha256": hex(body) }, SECRET);
    expect(ev).toMatchObject({ type: "order_paid", eventId: "order/paid:987:123456", schemeConfirmed: false });
    expect(ev.sale).toMatchObject({ externalId: "987", status: "approved", amountMinor: null });
    // Thin payload + unconfirmed scheme: never linkable to a CRMWSP order.
    expect(decideExternalSale(ev, { id: ORDER_ID, totalMinor: 100n, currency: "ARS" }).link).toBe(false);
  });

  it("rejects invalid, missing and wrong-secret signatures", () => {
    expect(() => tiendanubeConnector.verifyWebhook(enc(body), { "x-linkedstore-hmac-sha256": hex(body, "other") }, SECRET)).toThrow(InvalidSignatureError);
    expect(() => tiendanubeConnector.verifyWebhook(enc(body), {}, SECRET)).toThrow(InvalidSignatureError);
    const tampered = body.replace("987", "988");
    expect(() => tiendanubeConnector.verifyWebhook(enc(tampered), { "x-linkedstore-hmac-sha256": hex(body) }, SECRET)).toThrow(InvalidSignatureError);
  });

  it("gives a replayed delivery the same dedupe key", () => {
    const h = { "x-linkedstore-hmac-sha256": hex(body) };
    expect(tiendanubeConnector.verifyWebhook(enc(body), h, SECRET).eventId).toBe(tiendanubeConnector.verifyWebhook(enc(body), h, SECRET).eventId);
  });

  it("pulls the catalog with localized names and variants", async () => {
    const root = "https://api.tiendanube.com/v1/123456";
    const { f, calls } = fakeFetch({
      [`${root}/store`]: { body: { main_currency: "ARS" } },
      [`${root}/products?page=1&per_page=200`]: {
        body: [
          {
            id: 1,
            name: { es: "Remera" },
            published: true,
            attributes: [{ es: "Talle" }],
            variants: [
              { id: 11, price: "1500.00", promotional_price: "1200.00", sku: "R-S", values: [{ es: "S" }] },
              { id: 12, price: "1500.00", sku: "R-M", values: [{ es: "M" }] },
            ],
          },
        ],
      },
    });
    const page = await tiendanubeConnector.listProducts!({ shopDomain: "123456", accessToken: "tn-token" }, f);
    expect(page.currency).toBe("ARS");
    expect(page.products[0]).toMatchObject({ name: "Remera", priceMinor: 120000 });
    expect(page.products[0]!.variants[0]).toMatchObject({ options: { Talle: "S" }, priceMinor: 120000, compareAtMinor: 150000 });
    expect(calls[0]!.headers["Authentication"]).toBe("bearer tn-token");
    await expect(tiendanubeConnector.listProducts!({ shopDomain: "evil.com/x", accessToken: "t" }, f)).rejects.toThrow();
  });
});

describe("WooCommerce", () => {
  const order = JSON.stringify({
    id: 4321,
    status: "processing",
    total: "2500.50",
    currency: "ARS",
    billing: { email: "ana@example.com", phone: "+5491122223333", first_name: "Ana", last_name: "Gómez" },
    line_items: [{ product_id: 9, name: "Curso" }],
    meta_data: [{ key: "crmwsp_order_id", value: ORDER_ID }],
    date_paid_gmt: "2026-10-01T10:00:00",
  });
  const sig = (b: string, s = SECRET) => createHmac("sha256", s).update(b).digest("base64");
  const headers = (b: string, s = SECRET) => ({ "X-WC-Webhook-Signature": sig(b, s), "x-wc-webhook-topic": "order.updated", "x-wc-webhook-delivery-id": "d-1" });

  it("accepts a valid X-WC-Webhook-Signature and normalizes a paid order", () => {
    const ev = woocommerceConnector.verifyWebhook(enc(order), headers(order), SECRET);
    expect(ev).toMatchObject({ type: "order_paid", eventId: "wh:d-1", schemeConfirmed: true });
    expect(ev.sale).toMatchObject({ externalId: "4321", status: "approved", amountMinor: 250050, currency: "ARS", crmwspOrderId: ORDER_ID });
    expect(decideExternalSale(ev, { id: ORDER_ID, totalMinor: 250050n, currency: "ARS" })).toEqual({ link: true, orderId: ORDER_ID });
  });

  it("rejects invalid, missing and tampered signatures", () => {
    expect(() => woocommerceConnector.verifyWebhook(enc(order), headers(order, "other"), SECRET)).toThrow(InvalidSignatureError);
    expect(() => woocommerceConnector.verifyWebhook(enc(order), { "x-wc-webhook-topic": "order.updated" }, SECRET)).toThrow(InvalidSignatureError);
    const tampered = order.replace("2500.50", "1.00");
    expect(() => woocommerceConnector.verifyWebhook(enc(tampered), headers(order), SECRET)).toThrow(InvalidSignatureError);
  });

  it("gives a replayed delivery the same dedupe key", () => {
    const a = woocommerceConnector.verifyWebhook(enc(order), headers(order), SECRET);
    const b = woocommerceConnector.verifyWebhook(enc(order), headers(order), SECRET);
    expect(a.eventId).toBe(b.eventId);
  });

  it("only accepts public https site URLs", () => {
    expect(normalizeWooSiteUrl("https://tienda.example.com/")).toBe("https://tienda.example.com");
    expect(normalizeWooSiteUrl("http://tienda.example.com")).toBeNull();
    expect(normalizeWooSiteUrl("https://127.0.0.1")).toBeNull();
    expect(normalizeWooSiteUrl("https://localhost")).toBeNull();
    expect(normalizeWooSiteUrl("https://u:p@tienda.example.com")).toBeNull();
  });

  it("pulls the catalog with basic auth and variations", async () => {
    const root = "https://tienda.example.com/wp-json/wc/v3";
    const { f, calls } = fakeFetch({
      [`${root}/settings/general/woocommerce_currency`]: { body: { value: "ARS" } },
      [`${root}/products?per_page=100&page=1`]: {
        body: [
          { id: 1, name: "Taza", type: "simple", status: "publish", price: "900", regular_price: "1000", sale_price: "900", sku: "T1" },
          { id: 2, name: "Remera", type: "variable", status: "publish", price: "1500" },
        ],
        headers: { "x-wp-totalpages": "1" },
      },
      [`${root}/products/2/variations?per_page=100`]: { body: [{ id: 21, price: "1500", regular_price: "1500", attributes: [{ name: "Talle", option: "M" }] }] },
    });
    const page = await woocommerceConnector.listProducts!({ shopDomain: "https://tienda.example.com", accessToken: "ck_abc:cs_def" }, f);
    expect(page.products).toHaveLength(2);
    expect(page.products[0]!.variants[0]).toMatchObject({ priceMinor: 90000, compareAtMinor: 100000 });
    expect(page.products[1]!.variants[0]).toMatchObject({ externalId: "21", options: { Talle: "M" }, priceMinor: 150000 });
    expect(calls[0]!.headers["Authorization"]).toBe(`Basic ${Buffer.from("ck_abc:cs_def").toString("base64")}`);
    expect(calls.every((c) => c.url.startsWith(`${root}/`))).toBe(true);
  });
});
