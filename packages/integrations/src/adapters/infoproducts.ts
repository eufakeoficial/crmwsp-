import { createHash } from "node:crypto";
import type { CommerceConnector, CommerceEventType, CommerceProvider, ExternalSaleStatus, NormalizedCommerceEvent, NormalizedSale, VerificationScheme } from "../types.js";
import {
  CommercePayloadError,
  InvalidSignatureError,
  currencyOf,
  dateOf,
  decimalToMinor,
  fromHex,
  header,
  hmac,
  integerMinor,
  obj,
  parseForm,
  parseJsonObject,
  safeEqual,
  safeEqualText,
  str,
} from "../util.js";

/*
 * Infoproduct platforms. None of these sales is trusted to touch a CRMWSP order: they are
 * recorded as external sales only. All of them also sit behind the opaque per-connection token
 * in the webhook URL (resolved server-side), which is the minimum gate for every scheme here.
 */

function event(
  provider: CommerceProvider,
  verification: VerificationScheme,
  schemeConfirmed: boolean,
  eventId: string,
  providerEventType: string,
  type: CommerceEventType,
  sale: NormalizedSale | null,
): NormalizedCommerceEvent {
  return {
    provider,
    eventId: eventId.slice(0, 255),
    providerEventType: providerEventType.slice(0, 120) || "unknown",
    type,
    verification,
    schemeConfirmed,
    sale: type === "ignored" ? null : sale,
    product: null,
  };
}

function classify(status: ExternalSaleStatus | null): CommerceEventType {
  return status === "approved" ? "purchase_approved" : status === "refunded" ? "purchase_refunded" : "ignored";
}

// --- Hotmart -------------------------------------------------------------------------------

const HOTMART_APPROVED = new Set(["PURCHASE_APPROVED", "PURCHASE_COMPLETE"]);
const HOTMART_REFUNDED = new Set(["PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"]);

/**
 * Hotmart webhook v2: static "hottok" in the `X-HOTMART-HOTTOK` header (v1 sent it as the body
 * field `hottok`). It is a shared secret, NOT a signature over the body.
 */
export const hotmartConnector: CommerceConnector = {
  provider: "hotmart",
  verification: "shared_token",
  verifyWebhook(rawBody, headers, secret) {
    const body = parseJsonObject(rawBody);
    const given = header(headers, "x-hotmart-hottok") ?? str(body["hottok"], 256) ?? undefined;
    if (!safeEqualText(given, secret)) throw new InvalidSignatureError();
    const name = str(body["event"], 120) ?? "";
    const data = obj(body["data"]);
    const purchase = obj(data["purchase"]);
    const price = obj(purchase["price"]);
    const buyer = obj(data["buyer"]);
    const product = obj(data["product"]);
    const transaction = str(purchase["transaction"], 120);
    const status: ExternalSaleStatus | null = HOTMART_APPROVED.has(name) ? "approved" : HOTMART_REFUNDED.has(name) ? "refunded" : null;
    const type = classify(status);
    if (type !== "ignored" && !transaction) throw new CommercePayloadError("Hotmart purchase without transaction");
    const currency = currencyOf(price["currency_value"]);
    const eventId = str(body["id"], 200) ?? `${name}:${transaction ?? "?"}`;
    return event("hotmart", "shared_token", true, eventId, name, type, {
      externalId: transaction ?? "",
      status: status ?? "pending",
      amountMinor: decimalToMinor(price["value"], currency),
      currency,
      buyer: { email: str(buyer["email"], 254), phone: str(buyer["checkout_phone"], 32) ?? str(buyer["phone"], 32), name: str(buyer["name"], 200) },
      productRef: str(product["id"], 64),
      productName: str(product["name"], 300),
      crmwspOrderId: null,
      occurredAt: dateOf(purchase["approved_date"]) ?? dateOf(body["creation_date"]),
    });
  },
};

// --- Kiwify --------------------------------------------------------------------------------

/**
 * UNVERIFIED against provider docs: Kiwify appends `?signature=<hex HMAC-SHA1(token, raw body)>`
 * to the webhook URL. Amounts (`Commissions.charge_amount`) are assumed to be integer cents.
 */
export const kiwifyConnector: CommerceConnector = {
  provider: "kiwify",
  verification: "hmac_body",
  verifyWebhook(rawBody, _headers, secret, ctx = {}) {
    const given = fromHex(ctx.query?.["signature"], 20);
    if (!given || !secret || !safeEqual(hmac("sha1", secret, rawBody), given)) throw new InvalidSignatureError();
    const body = parseJsonObject(rawBody);
    const orderId = str(body["order_id"], 120);
    const orderStatus = str(body["order_status"], 60) ?? "";
    const name = str(body["webhook_event_type"], 120) ?? orderStatus;
    const status: ExternalSaleStatus | null =
      orderStatus === "paid" || orderStatus === "approved" ? "approved" : orderStatus === "refunded" || orderStatus === "chargedback" ? "refunded" : null;
    const type = classify(status);
    if (type !== "ignored" && !orderId) throw new CommercePayloadError("Kiwify order without order_id");
    const customer = obj(body["Customer"]);
    const product = obj(body["Product"]);
    const commissions = obj(body["Commissions"]);
    return event("kiwify", "hmac_body", false, `${name}:${orderId ?? "?"}:${orderStatus}`, name, type, {
      externalId: orderId ?? "",
      status: status ?? "pending",
      amountMinor: integerMinor(commissions["charge_amount"]),
      currency: currencyOf(commissions["currency"]) ?? currencyOf(body["currency"]),
      buyer: { email: str(customer["email"], 254), phone: str(customer["mobile"], 32), name: str(customer["full_name"], 200) },
      productRef: str(product["product_id"], 64),
      productName: str(product["product_name"], 300),
      crmwspOrderId: null,
      occurredAt: dateOf(body["approved_date"]) ?? dateOf(body["created_at"]),
    });
  },
};

// --- Eduzz ---------------------------------------------------------------------------------

/**
 * UNVERIFIED against provider docs: assumes the current Eduzz webhook sends
 * `x-signature: <hex HMAC-SHA256(secret, raw body)>` with `{ id, event, data: {...} }` and events
 * like `myeduzz.invoice_paid` / `myeduzz.invoice_refunded`.
 */
export const eduzzConnector: CommerceConnector = {
  provider: "eduzz",
  verification: "hmac_body",
  verifyWebhook(rawBody, headers, secret) {
    const given = fromHex(header(headers, "x-signature"), 32);
    if (!given || !secret || !safeEqual(hmac("sha256", secret, rawBody), given)) throw new InvalidSignatureError();
    const body = parseJsonObject(rawBody);
    const name = str(body["event"], 120) ?? "";
    const data = obj(body["data"]);
    const invoiceId = str(data["id"], 120);
    const status: ExternalSaleStatus | null = /(_paid|\.paid|_approved)$/.test(name) ? "approved" : /(_refunded|\.refunded|_chargeback)$/.test(name) ? "refunded" : null;
    const type = classify(status);
    if (type !== "ignored" && !invoiceId) throw new CommercePayloadError("Eduzz event without invoice id");
    const price = obj(data["price"]);
    const buyer = obj(data["buyer"]);
    const item = obj(Array.isArray(data["items"]) ? data["items"][0] : undefined);
    const currency = currencyOf(price["currency"]);
    return event("eduzz", "hmac_body", false, str(body["id"], 200) ?? `${name}:${invoiceId ?? "?"}`, name, type, {
      externalId: invoiceId ?? "",
      status: status ?? "pending",
      amountMinor: decimalToMinor(price["value"], currency),
      currency,
      buyer: { email: str(buyer["email"], 254), phone: str(buyer["cellphone"], 32) ?? str(buyer["phone"], 32), name: str(buyer["name"], 200) },
      productRef: str(item["productId"], 64),
      productName: str(item["name"], 300),
      crmwspOrderId: null,
      occurredAt: dateOf(data["paidAt"]) ?? dateOf(data["createdAt"]),
    });
  },
};

// --- Gumroad -------------------------------------------------------------------------------

/**
 * UNVERIFIED against provider docs: Gumroad "Ping" is an unsigned
 * application/x-www-form-urlencoded POST. The only checks available are the URL token and the
 * `seller_id` matching the configured one (the connection secret). `price` is integer cents.
 */
export const gumroadConnector: CommerceConnector = {
  provider: "gumroad",
  verification: "shared_token",
  verifyWebhook(rawBody, _headers, secret) {
    const f = parseForm(rawBody);
    if (!safeEqualText(f["seller_id"], secret)) throw new InvalidSignatureError();
    const saleId = str(f["sale_id"], 120);
    if (!saleId) return event("gumroad", "shared_token", false, `noop:${createHash("sha256").update(rawBody).digest("hex")}`, f["resource_name"] ?? "ping", "ignored", null);
    const refunded = f["refunded"] === "true" || f["resource_name"] === "refund";
    const status: ExternalSaleStatus = refunded ? "refunded" : "approved";
    return event("gumroad", "shared_token", false, `${saleId}:${status}`, f["resource_name"] ?? "sale", classify(status), {
      externalId: saleId,
      status,
      amountMinor: integerMinor(f["price"]),
      currency: currencyOf(f["currency"]),
      buyer: { email: str(f["email"], 254), phone: null, name: str(f["full_name"], 200) },
      productRef: str(f["product_id"], 64),
      productName: str(f["product_name"], 300),
      crmwspOrderId: null,
      occurredAt: dateOf(f["sale_timestamp"]),
    });
  },
};

// --- Payhip --------------------------------------------------------------------------------

/**
 * UNVERIFIED against provider docs: Payhip puts `signature = hex SHA-256(api key)` in the JSON
 * body (a static token, not a body HMAC); `type` is `paid` / `refunded`; `price` is assumed to be
 * integer cents.
 */
export const payhipConnector: CommerceConnector = {
  provider: "payhip",
  verification: "shared_token",
  verifyWebhook(rawBody, _headers, secret) {
    const body = parseJsonObject(rawBody);
    const expected = createHash("sha256").update(secret, "utf8").digest("hex");
    if (!secret || !safeEqualText(str(body["signature"], 128)?.toLowerCase(), expected)) throw new InvalidSignatureError();
    const kind = str(body["type"], 60) ?? "";
    const id = str(body["id"], 120);
    const status: ExternalSaleStatus | null = kind === "paid" ? "approved" : kind === "refunded" ? "refunded" : null;
    const type = classify(status);
    if (type !== "ignored" && !id) throw new CommercePayloadError("Payhip event without id");
    const item = obj(Array.isArray(body["items"]) ? body["items"][0] : undefined);
    return event("payhip", "shared_token", false, `${kind}:${id ?? "?"}`, kind, type, {
      externalId: id ?? "",
      status: status ?? "pending",
      amountMinor: integerMinor(body["price"]),
      currency: currencyOf(body["currency"]),
      buyer: { email: str(body["email"], 254), phone: null, name: null },
      productRef: str(item["product_id"], 64),
      productName: str(item["product_name"], 300),
      crmwspOrderId: null,
      occurredAt: dateOf(body["date"]),
    });
  },
};
