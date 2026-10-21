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
 * WooCommerce (self-hosted WordPress).
 * Webhooks: `X-WC-Webhook-Signature` = base64(HMAC-SHA256(webhook secret, raw body)); topic in
 * `X-WC-Webhook-Topic` (`order.created`, `order.updated`, `product.updated`...), delivery id in
 * `X-WC-Webhook-Delivery-ID`. The body is the full REST resource.
 * Catalog: REST API v3 `{site}/wp-json/wc/v3` with HTTP Basic `consumer_key:consumer_secret`
 * (https only), page-number pagination via `X-WP-TotalPages`.
 * The site URL is merchant-supplied: only public https hostnames are accepted (SSRF guard), and
 * every request stays on that origin.
 */

const PER_PAGE = 100;
/** Paid per WooCommerce semantics (payment captured); `on-hold` = awaiting manual payment. */
const PAID_STATUSES = new Set(["processing", "completed"]);

/** Normalizes a merchant site URL to `https://host[/path]` or returns null when not acceptable. */
export function normalizeWooSiteUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return null;
  // No IP literals or internal names (credentials must only reach a public store).
  if (/^\d+(\.\d+){3}$/.test(host) || host === "localhost" || /\.(local|internal|localhost|lan|home|corp)$/.test(host)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${host}${path}`;
}

function verifyWoo(rawBody: Uint8Array, headers: WebhookHeaders, secret: string): void {
  const given = fromBase64(header(headers, "x-wc-webhook-signature"), 32);
  if (!given || !secret) throw new InvalidSignatureError();
  if (!safeEqual(hmac("sha256", secret, rawBody), given)) throw new InvalidSignatureError();
}

function metaValue(o: Record<string, unknown>, key: string): unknown {
  for (const m of Array.isArray(o["meta_data"]) ? o["meta_data"] : []) {
    const e = obj(m);
    if (e["key"] === key) return e["value"];
  }
  return undefined;
}

function saleFromOrder(order: Record<string, unknown>): NormalizedSale {
  const externalId = str(order["id"], 64);
  if (!externalId) throw new CommercePayloadError("WooCommerce order without id");
  const currency = currencyOf(order["currency"]);
  const billing = obj(order["billing"]);
  const first = obj(Array.isArray(order["line_items"]) ? order["line_items"][0] : undefined);
  const s = str(order["status"], 40);
  const status: NormalizedSale["status"] = s === "refunded" ? "refunded" : s && PAID_STATUSES.has(s) ? "approved" : "pending";
  const name = [str(billing["first_name"], 100), str(billing["last_name"], 100)].filter(Boolean).join(" ");
  return {
    externalId,
    status,
    amountMinor: decimalToMinor(order["total"], currency),
    currency,
    buyer: { email: str(billing["email"], 254), phone: str(billing["phone"], 32), name: name || null },
    productRef: str(first["product_id"], 64),
    productName: str(first["name"], 300),
    crmwspOrderId: uuidOrNull(metaValue(order, "crmwsp_order_id")),
    occurredAt: dateOf(order["date_paid_gmt"] ? `${String(order["date_paid_gmt"])}Z` : null) ?? dateOf(order["date_created_gmt"] ? `${String(order["date_created_gmt"])}Z` : null),
  };
}

function wooPrice(o: Record<string, unknown>, currency: string): { price: number | null; compareAt: number | null } {
  const sale = decimalToMinor(o["sale_price"], currency);
  const regular = decimalToMinor(o["regular_price"], currency);
  const price = decimalToMinor(o["price"], currency) ?? sale ?? regular;
  return { price, compareAt: sale !== null && regular !== null && regular > sale ? regular : null };
}

export function normalizeWooProduct(raw: unknown, currency: string, variations: unknown[] = []): CatalogProduct | null {
  const p = obj(raw);
  const externalId = str(p["id"], 64);
  const name = str(p["name"], 300);
  if (!externalId || !name) return null;
  const variants: CatalogVariant[] = [];
  for (const rv of variations) {
    const v = obj(rv);
    const id = str(v["id"], 64);
    if (!id) continue;
    const options: Record<string, string> = {};
    for (const a of Array.isArray(v["attributes"]) ? v["attributes"] : []) {
      const ao = obj(a);
      const k = str(ao["name"], 60);
      const val = str(ao["option"], 120);
      if (k && val) options[k] = val;
    }
    const { price, compareAt } = wooPrice(v, currency);
    variants.push({ externalId: id, sku: str(v["sku"], 120), options, priceMinor: price, compareAtMinor: compareAt });
  }
  if (variants.length === 0) {
    const { price, compareAt } = wooPrice(p, currency);
    variants.push({ externalId, sku: str(p["sku"], 120), options: {}, priceMinor: price, compareAtMinor: compareAt });
  }
  const priceMinor = variants.find((v) => v.priceMinor !== null)?.priceMinor ?? null;
  if (priceMinor === null) return null;
  return {
    externalId,
    name,
    description: str(p["description"], 20_000),
    active: p["status"] === undefined || p["status"] === "publish",
    priceMinor,
    variants,
  };
}

function basicAuth(accessToken: string): string {
  const i = accessToken.indexOf(":");
  if (i <= 0 || i === accessToken.length - 1) throw new CommercePayloadError("WooCommerce credentials must be consumer_key:consumer_secret");
  return `Basic ${Buffer.from(accessToken, "utf8").toString("base64")}`;
}

export const woocommerceConnector: CommerceConnector = {
  provider: "woocommerce",
  verification: "hmac_body",

  verifyWebhook(rawBody, headers, secret, ctx: VerifyContext = {}): NormalizedCommerceEvent {
    verifyWoo(rawBody, headers, secret);
    const topic = header(headers, "x-wc-webhook-topic") ?? "";
    const body = parseJsonObject(rawBody);
    const delivery = header(headers, "x-wc-webhook-delivery-id");
    const fallbackId = `${topic}:${str(body["id"], 64) ?? "?"}:${str(body["date_modified_gmt"], 64) ?? ""}`;
    const base = {
      provider: "woocommerce" as const,
      eventId: (delivery ? `wh:${delivery}` : fallbackId).slice(0, 255),
      providerEventType: topic.slice(0, 120) || "unknown",
      verification: "hmac_body" as const,
      schemeConfirmed: true,
      sale: null,
      product: null,
    };
    switch (topic) {
      case "order.created":
      case "order.updated": {
        const sale = saleFromOrder(body);
        const type = sale.status === "refunded" ? "order_refunded" : sale.status === "approved" ? "order_paid" : "order_created";
        return { ...base, type, sale };
      }
      case "product.created":
      case "product.updated": {
        const currency = currencyOf(ctx.currency);
        // Variable products need their variations: left to the catalog sync.
        const product = currency && body["type"] !== "variable" ? normalizeWooProduct(body, currency) : null;
        return product ? { ...base, type: "product_updated", product } : { ...base, type: "ignored" };
      }
      default:
        return { ...base, type: "ignored" };
    }
  },

  async listProducts(source: CatalogSource, fetchImpl: FetchLike): Promise<CatalogPage> {
    const site = normalizeWooSiteUrl(source.shopDomain);
    if (!site) throw new CommercePayloadError("Invalid WooCommerce site URL");
    const root = `${site}/wp-json/wc/v3`;
    const headers = { Authorization: basicAuth(source.accessToken), Accept: "application/json" };
    const get = async (path: string) => {
      const url = `${root}${path}`;
      const res = await fetchImpl(url, { method: "GET", headers });
      if (!res.ok) throw new CommercePayloadError(`WooCommerce request failed (${res.status})`);
      return res;
    };
    const curRes = await get("/settings/general/woocommerce_currency");
    const currency = currencyOf(obj(await curRes.json())["value"]);
    if (!currency) throw new CommercePayloadError("WooCommerce store without currency");

    const products: CatalogProduct[] = [];
    for (let page = 1; page <= 200; page++) {
      const res = await get(`/products?per_page=${PER_PAGE}&page=${page}`);
      const list = await res.json();
      const items = Array.isArray(list) ? list : [];
      for (const raw of items) {
        const p = obj(raw);
        let variations: unknown[] = [];
        if (p["type"] === "variable" && str(p["id"], 64)) {
          const vr = await get(`/products/${encodeURIComponent(String(p["id"]))}/variations?per_page=${PER_PAGE}`);
          const vl = await vr.json();
          variations = Array.isArray(vl) ? vl : [];
        }
        const n = normalizeWooProduct(raw, currency, variations);
        if (n) products.push(n);
      }
      const total = Number(res.headers.get("x-wp-totalpages"));
      if (items.length < PER_PAGE || (Number.isFinite(total) && total > 0 && page >= total)) break;
    }
    return { currency, products };
  },
};
