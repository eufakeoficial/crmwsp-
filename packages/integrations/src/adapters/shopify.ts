import type {
  CatalogPage,
  CatalogProduct,
  CatalogSource,
  CatalogVariant,
  CommerceConnector,
  FetchLike,
  NormalizedCommerceEvent,
  NormalizedSale,
  VerifyContext,
  WebhookHeaders,
} from "../types.js";
import {
  CommercePayloadError,
  InvalidSignatureError,
  currencyOf,
  dateOf,
  decimalToMinor,
  fromBase64,
  header,
  hmac,
  obj,
  parseJsonObject,
  safeEqual,
  str,
  uuidOrNull,
} from "../util.js";

/*
 * Shopify webhooks: `X-Shopify-Hmac-Sha256` = base64(HMAC-SHA256(app client secret, raw body)).
 * Topic in `X-Shopify-Topic`, delivery id in `X-Shopify-Webhook-Id` (stable across retries of the
 * same delivery, so it is the dedupe key). Catalog via Admin REST API with
 * `X-Shopify-Access-Token`, paginated by the `Link: <...page_info=...>; rel="next"` header.
 */

export const SHOPIFY_API_VERSION = "2024-10";
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

export function isShopifyDomain(domain: string): boolean {
  return SHOP_DOMAIN_RE.test(domain);
}

function verifyShopify(rawBody: Uint8Array, headers: WebhookHeaders, secret: string): void {
  const given = fromBase64(header(headers, "x-shopify-hmac-sha256"), 32);
  if (!given || !secret) throw new InvalidSignatureError();
  if (!safeEqual(hmac("sha256", secret, rawBody), given)) throw new InvalidSignatureError();
}

function noteAttribute(order: Record<string, unknown>, name: string): unknown {
  const attrs = Array.isArray(order["note_attributes"]) ? order["note_attributes"] : [];
  for (const a of attrs) {
    const o = obj(a);
    if (o["name"] === name) return o["value"];
  }
  return undefined;
}

function saleFromOrder(order: Record<string, unknown>, status: NormalizedSale["status"]): NormalizedSale {
  const externalId = str(order["id"], 64);
  if (!externalId) throw new CommercePayloadError("Shopify order without id");
  const currency = currencyOf(order["currency"]);
  const customer = obj(order["customer"]);
  const billing = obj(order["billing_address"]);
  const firstItem = obj(Array.isArray(order["line_items"]) ? order["line_items"][0] : undefined);
  const fullName = [str(customer["first_name"], 100), str(customer["last_name"], 100)].filter(Boolean).join(" ");
  return {
    externalId,
    status,
    amountMinor: decimalToMinor(order["total_price"], currency),
    currency,
    buyer: {
      email: str(order["email"], 254) ?? str(customer["email"], 254),
      phone: str(order["phone"], 32) ?? str(customer["phone"], 32) ?? str(billing["phone"], 32),
      name: fullName || str(billing["name"], 200),
    },
    productRef: str(firstItem["product_id"], 64),
    productName: str(firstItem["title"], 300),
    crmwspOrderId: uuidOrNull(noteAttribute(order, "crmwsp_order_id")),
    occurredAt: dateOf(order["processed_at"]) ?? dateOf(order["created_at"]),
  };
}

function variantOptions(product: Record<string, unknown>, v: Record<string, unknown>): Record<string, string> {
  const names = Array.isArray(product["options"]) ? product["options"].map((o) => str(obj(o)["name"], 60)) : [];
  const out: Record<string, string> = {};
  for (let i = 0; i < 3; i++) {
    const value = str(v[`option${i + 1}`], 120);
    const name = names[i] ?? `option${i + 1}`;
    // Shopify's placeholder for single-variant products.
    if (value && !(name === "Title" && value === "Default Title")) out[name] = value;
  }
  return out;
}

export function normalizeShopifyProduct(raw: unknown, currency: string): CatalogProduct | null {
  const p = obj(raw);
  const externalId = str(p["id"], 64);
  const name = str(p["title"], 300);
  if (!externalId || !name) return null;
  const variants: CatalogVariant[] = [];
  for (const rv of Array.isArray(p["variants"]) ? p["variants"] : []) {
    const v = obj(rv);
    const id = str(v["id"], 64);
    if (!id) continue;
    variants.push({
      externalId: id,
      sku: str(v["sku"], 120),
      options: variantOptions(p, v),
      priceMinor: decimalToMinor(v["price"], currency),
      compareAtMinor: decimalToMinor(v["compare_at_price"], currency),
    });
  }
  const priceMinor = variants.find((v) => v.priceMinor !== null)?.priceMinor ?? null;
  if (priceMinor === null) return null;
  return {
    externalId,
    name,
    description: str(p["body_html"], 20_000),
    active: p["status"] === undefined || p["status"] === "active",
    priceMinor,
    variants,
  };
}

function nextPageUrl(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m?.[1]) return m[1];
  }
  return null;
}

export const shopifyConnector: CommerceConnector = {
  provider: "shopify",
  verification: "hmac_body",

  verifyWebhook(rawBody, headers, secret, ctx: VerifyContext = {}): NormalizedCommerceEvent {
    verifyShopify(rawBody, headers, secret);
    const topic = header(headers, "x-shopify-topic") ?? "";
    const body = parseJsonObject(rawBody);
    const webhookId = header(headers, "x-shopify-webhook-id") ?? header(headers, "x-shopify-event-id");
    const fallbackId = `${topic}:${str(body["id"], 64) ?? "?"}:${str(body["updated_at"], 64) ?? str(body["created_at"], 64) ?? ""}`;
    const base = {
      provider: "shopify" as const,
      eventId: (webhookId ? `wh:${webhookId}` : fallbackId).slice(0, 255),
      providerEventType: topic.slice(0, 120) || "unknown",
      verification: "hmac_body" as const,
      schemeConfirmed: true,
      sale: null,
      product: null,
    };
    switch (topic) {
      case "orders/create":
        return { ...base, type: "order_created", sale: saleFromOrder(body, body["financial_status"] === "paid" ? "approved" : "pending") };
      case "orders/paid":
        return { ...base, type: "order_paid", sale: saleFromOrder(body, "approved") };
      case "refunds/create": {
        const orderId = str(body["order_id"], 64);
        if (!orderId) throw new CommercePayloadError("Shopify refund without order_id");
        const txs = Array.isArray(body["transactions"]) ? body["transactions"].map(obj) : [];
        const currency = currencyOf(txs[0]?.["currency"]) ?? currencyOf(ctx.currency);
        let total: number | null = 0;
        for (const t of txs) {
          if (t["kind"] !== "refund" || (t["status"] !== undefined && t["status"] !== "success")) continue;
          const m = decimalToMinor(t["amount"], currency);
          total = m === null || total === null ? null : total + m;
        }
        return {
          ...base,
          type: "order_refunded",
          sale: {
            externalId: orderId,
            status: "refunded",
            amountMinor: total,
            currency,
            buyer: { email: null, phone: null, name: null },
            productRef: null,
            productName: null,
            crmwspOrderId: null,
            occurredAt: dateOf(body["created_at"]),
          },
        };
      }
      case "products/update":
      case "products/create": {
        const currency = currencyOf(ctx.currency);
        const product = currency ? normalizeShopifyProduct(body, currency) : null;
        return product ? { ...base, type: "product_updated", product } : { ...base, type: "ignored" };
      }
      default:
        return { ...base, type: "ignored" };
    }
  },

  async listProducts(source: CatalogSource, fetchImpl: FetchLike): Promise<CatalogPage> {
    if (!isShopifyDomain(source.shopDomain)) throw new CommercePayloadError("Invalid Shopify shop domain");
    const headers = { "X-Shopify-Access-Token": source.accessToken, Accept: "application/json" };
    const root = `https://${source.shopDomain}/admin/api/${SHOPIFY_API_VERSION}`;
    const shopRes = await fetchImpl(`${root}/shop.json`, { method: "GET", headers });
    if (!shopRes.ok) throw new CommercePayloadError(`Shopify shop request failed (${shopRes.status})`);
    const currency = currencyOf(obj(obj(await shopRes.json())["shop"])["currency"]);
    if (!currency) throw new CommercePayloadError("Shopify shop without currency");

    const products: CatalogProduct[] = [];
    let url: string | null = `${root}/products.json?limit=250`;
    for (let page = 0; url && page < 200; page++) {
      // Never follow a pagination link off the shop's own Admin API (SSRF / token leak guard).
      if (!url.startsWith(`${root}/`)) throw new CommercePayloadError("Unexpected Shopify pagination URL");
      const res = await fetchImpl(url, { method: "GET", headers });
      if (!res.ok) throw new CommercePayloadError(`Shopify products request failed (${res.status})`);
      const list = obj(await res.json())["products"];
      for (const raw of Array.isArray(list) ? list : []) {
        const p = normalizeShopifyProduct(raw, currency);
        if (p) products.push(p);
      }
      url = nextPageUrl(res.headers.get("link"));
    }
    return { currency, products };
  },
};
