import type { CatalogPage, CatalogProduct, CatalogSource, CatalogVariant, CommerceConnector, FetchLike, NormalizedCommerceEvent, WebhookHeaders } from "../types.js";
import { CommercePayloadError, InvalidSignatureError, currencyOf, decimalToMinor, fromBase64, fromHex, header, hmac, obj, parseJsonObject, safeEqual, str } from "../util.js";

/*
 * Tiendanube / Nuvemshop.
 * Webhooks: `x-linkedstore-hmac-sha256` = HMAC-SHA256(app client secret, raw body). The body is
 * thin: `{ store_id, event: "order/paid", id }` (no amounts, no buyer), so a sale is recorded
 * WITHOUT amount and can never be linked to a CRMWSP order (decideExternalSale needs the amount).
 * UNVERIFIED against provider docs (unreachable when written): digest encoding assumed hex, base64
 * also accepted; `schemeConfirmed` is false until checked.
 * Catalog: REST `https://api.tiendanube.com/v1/{store_id}`, header `Authentication: bearer <token>`
 * (sic, not Authorization) and a mandatory User-Agent; page-number pagination.
 */

const API_ROOT = "https://api.tiendanube.com/v1";
const USER_AGENT = "CRMWSP (soporte@crmwsp.app)";
const PER_PAGE = 200;

export function isTiendanubeStoreId(v: string): boolean {
  return /^\d{1,20}$/.test(v);
}

function verifyTiendanube(rawBody: Uint8Array, headers: WebhookHeaders, secret: string): void {
  const raw = header(headers, "x-linkedstore-hmac-sha256");
  const given = fromHex(raw, 32) ?? fromBase64(raw, 32);
  if (!given || !secret) throw new InvalidSignatureError();
  if (!safeEqual(hmac("sha256", secret, rawBody), given)) throw new InvalidSignatureError();
}

/** Tiendanube localizes text as `{ es: "...", pt: "..." }`. */
function localized(v: unknown, max: number): string | null {
  if (typeof v === "string") return str(v, max);
  const o = obj(v);
  return str(o["es"], max) ?? str(o["pt"], max) ?? str(o["en"], max) ?? str(Object.values(o)[0], max);
}

export function normalizeTiendanubeProduct(raw: unknown, currency: string): CatalogProduct | null {
  const p = obj(raw);
  const externalId = str(p["id"], 64);
  const name = localized(p["name"], 300);
  if (!externalId || !name) return null;
  const attrs = Array.isArray(p["attributes"]) ? p["attributes"].map((a) => localized(a, 60)) : [];
  const variants: CatalogVariant[] = [];
  for (const rv of Array.isArray(p["variants"]) ? p["variants"] : []) {
    const v = obj(rv);
    const id = str(v["id"], 64);
    if (!id) continue;
    const options: Record<string, string> = {};
    const values = Array.isArray(v["values"]) ? v["values"] : [];
    values.forEach((val, i) => {
      const value = localized(val, 120);
      if (value) options[attrs[i] ?? `option${i + 1}`] = value;
    });
    const promo = decimalToMinor(v["promotional_price"], currency);
    const price = decimalToMinor(v["price"], currency);
    variants.push({
      externalId: id,
      sku: str(v["sku"], 120),
      options,
      priceMinor: promo ?? price,
      compareAtMinor: promo !== null ? price : decimalToMinor(v["compare_at_price"], currency),
    });
  }
  const priceMinor = variants.find((v) => v.priceMinor !== null)?.priceMinor ?? null;
  if (priceMinor === null) return null;
  return {
    externalId,
    name,
    description: localized(p["description"], 20_000),
    active: p["published"] === undefined || p["published"] === true,
    priceMinor,
    variants,
  };
}

export const tiendanubeConnector: CommerceConnector = {
  provider: "tiendanube",
  verification: "hmac_body",

  verifyWebhook(rawBody, headers, secret): NormalizedCommerceEvent {
    verifyTiendanube(rawBody, headers, secret);
    const body = parseJsonObject(rawBody);
    const event = str(body["event"], 60) ?? "";
    const id = str(body["id"], 64);
    const base = {
      provider: "tiendanube" as const,
      eventId: `${event}:${id ?? "?"}:${str(body["store_id"], 32) ?? ""}`.slice(0, 255),
      providerEventType: event || "unknown",
      verification: "hmac_body" as const,
      schemeConfirmed: false,
      sale: null,
      product: null,
    };
    const sale = (status: "pending" | "approved" | "refunded") => {
      if (!id) throw new CommercePayloadError("Tiendanube order event without id");
      return {
        externalId: id,
        status,
        amountMinor: null,
        currency: null,
        buyer: { email: null, phone: null, name: null },
        productRef: null,
        productName: null,
        crmwspOrderId: null,
        occurredAt: null,
      };
    };
    switch (event) {
      case "order/created":
        return { ...base, type: "order_created", sale: sale("pending") };
      case "order/paid":
        return { ...base, type: "order_paid", sale: sale("approved") };
      default:
        // Product events carry only the id: picked up by the next catalog sync.
        return { ...base, type: "ignored" };
    }
  },

  async listProducts(source: CatalogSource, fetchImpl: FetchLike): Promise<CatalogPage> {
    if (!isTiendanubeStoreId(source.shopDomain)) throw new CommercePayloadError("Invalid Tiendanube store id");
    const root = `${API_ROOT}/${source.shopDomain}`;
    const headers = { Authentication: `bearer ${source.accessToken}`, "User-Agent": USER_AGENT, Accept: "application/json" };
    const storeRes = await fetchImpl(`${root}/store`, { method: "GET", headers });
    if (!storeRes.ok) throw new CommercePayloadError(`Tiendanube store request failed (${storeRes.status})`);
    const currency = currencyOf(obj(await storeRes.json())["main_currency"]);
    if (!currency) throw new CommercePayloadError("Tiendanube store without currency");
    const products: CatalogProduct[] = [];
    for (let page = 1; page <= 200; page++) {
      const res = await fetchImpl(`${root}/products?page=${page}&per_page=${PER_PAGE}`, { method: "GET", headers });
      // Tiendanube answers 404 for a page past the last one.
      if (res.status === 404 && page > 1) break;
      if (!res.ok) throw new CommercePayloadError(`Tiendanube products request failed (${res.status})`);
      const list = await res.json();
      const items = Array.isArray(list) ? list : [];
      for (const raw of items) {
        const p = normalizeTiendanubeProduct(raw, currency);
        if (p) products.push(p);
      }
      if (items.length < PER_PAGE) break;
    }
    return { currency, products };
  },
};
