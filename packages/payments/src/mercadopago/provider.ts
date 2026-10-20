import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "@crmwsp/contracts";
import { isoExponent, normalizeCurrency } from "../currency.js";
import { InvalidSignatureError, PaymentProviderError } from "../errors.js";
import type { CreatePaymentLinkInput, PaymentLink, PaymentReference, VerifiedPaymentEvent, WebhookHeaders } from "../types.js";

/*
 * Mercado Pago (Checkout Pro) over plain fetch, same shape as the Stripe adapter.
 *
 * Webhook trust model: the notification body only carries a payment id, so it is NEVER trusted
 * for status or amount. Flow:
 *   1. verify `x-signature` (`ts=<ts>,v1=<hex>`): v1 = HMAC-SHA256(secret, manifest) with
 *      manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (parts whose value is absent
 *      are omitted; an alphanumeric data.id is lowercased), and reject a `ts` outside the
 *      tolerance window (replay guard);
 *   2. GET /v1/payments/{id} with the tenant's access token;
 *   3. only that API response is normalized into a VerifiedPaymentEvent.
 * The order<->payment link is our `external_reference` (`crmwsp:<tenant>:<kind>:<id>:<nonce>`),
 * which is also the `payments.provider_ref` of the attempt.
 */

export const MERCADOPAGO_DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export interface MercadoPagoSignatureInput {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
  secret: string;
  nowMs: number;
  toleranceMs?: number;
}

function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) {
      const s = Array.isArray(v) ? v[0] : v;
      return typeof s === "string" ? s.trim() : undefined;
    }
  }
  return undefined;
}

/** Throws InvalidSignatureError on any missing, malformed, mismatched or stale signature. */
export function verifyMercadoPagoSignature(i: MercadoPagoSignatureInput): void {
  if (!i.secret || !i.xSignature) throw new InvalidSignatureError();
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of i.xSignature.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "ts") ts = v;
    else if (k === "v1") v1 = v;
  }
  if (!ts || !/^\d{1,16}$/.test(ts) || !v1 || !/^[0-9a-fA-F]{64}$/.test(v1)) throw new InvalidSignatureError();
  const tsNum = Number(ts);
  // MP documents `ts` in seconds in some examples and milliseconds in others: accept both.
  const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
  const tolerance = i.toleranceMs ?? MERCADOPAGO_DEFAULT_TOLERANCE_MS;
  if (Math.abs(i.nowMs - tsMs) > tolerance) throw new InvalidSignatureError("Webhook timestamp outside tolerance");

  const dataId = i.dataId && /^[A-Za-z0-9]+$/.test(i.dataId) ? i.dataId.toLowerCase() : i.dataId;
  let manifest = "";
  if (dataId) manifest += `id:${dataId};`;
  if (i.xRequestId) manifest += `request-id:${i.xRequestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac("sha256", i.secret).update(manifest).digest();
  const given = Buffer.from(v1, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new InvalidSignatureError();
}

export type MercadoPagoNotification = { kind: "payment"; paymentId: string; action: string } | { kind: "ignored"; topic: string };

/**
 * Verifies a Mercado Pago webhook and extracts the payment id to fetch. The body is parsed only
 * after the signature check. `query` is the notification URL query (`data.id`, `type`).
 */
export function parseMercadoPagoNotification(
  rawBody: Uint8Array,
  headers: WebhookHeaders,
  query: Record<string, string | undefined>,
  secret: string,
  nowMs: number = Date.now(),
  toleranceMs?: number,
): MercadoPagoNotification {
  let body: Record<string, unknown> = {};
  const text = new TextDecoder().decode(rawBody);
  if (text.trim()) {
    try {
      const v: unknown = JSON.parse(text);
      if (v && typeof v === "object" && !Array.isArray(v)) body = v as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const data = body["data"] && typeof body["data"] === "object" ? (body["data"] as Record<string, unknown>) : {};
  const bodyId = typeof data["id"] === "string" || typeof data["id"] === "number" ? String(data["id"]) : undefined;
  // The signature is computed over the query `data.id`; fall back to the body only if absent.
  const dataId = query["data.id"] ?? bodyId;
  verifyMercadoPagoSignature({
    xSignature: headerValue(headers, "x-signature"),
    xRequestId: headerValue(headers, "x-request-id"),
    dataId,
    secret,
    nowMs,
    ...(toleranceMs !== undefined ? { toleranceMs } : {}),
  });
  if (bodyId !== undefined && query["data.id"] !== undefined && bodyId.toLowerCase() !== query["data.id"].toLowerCase()) {
    // Signed id and body id disagree: never fetch something the signature did not cover.
    throw new InvalidSignatureError();
  }
  const topic = String(query["type"] ?? body["type"] ?? query["topic"] ?? "");
  if (topic !== "payment" || !dataId) return { kind: "ignored", topic: topic.slice(0, 60) || "unknown" };
  if (!/^\d{1,30}$/.test(dataId)) throw new PaymentProviderError("mercadopago", "Invalid payment id in notification", false);
  return { kind: "payment", paymentId: dataId, action: typeof body["action"] === "string" ? body["action"].slice(0, 60) : "payment" };
}

export interface MercadoPagoPayment {
  id: string;
  /** Raw MP status: approved, pending, in_process, authorized, rejected, cancelled, refunded, charged_back. */
  status: string;
  amountMinor: number;
  currency: string;
  externalReference: string | null;
  reference: PaymentReference | null;
  occurredAt: Date;
}

const REF_RE = /^crmwsp:([0-9a-f-]{36}):(order|quote):([0-9a-f-]{36}):([A-Za-z0-9]{8,64})$/;

export function buildExternalReference(ref: PaymentReference, nonce: string): string {
  return `crmwsp:${ref.tenantId}:${ref.kind}:${ref.id}:${nonce}`;
}

export function parseExternalReference(v: string | null | undefined): PaymentReference | null {
  if (!v) return null;
  const m = REF_RE.exec(v);
  if (!m) return null;
  return { tenantId: m[1]!, kind: m[2] as "order" | "quote", id: m[3]! };
}

/** Exact decimal major units -> ISO minor units (no float rounding). Null if not representable. */
export function majorToMinor(value: unknown, currency: string): number | null {
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    s = String(value);
  } else if (typeof value === "string") s = value.trim();
  else return null;
  const m = /^(\d{1,15})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const exp = isoExponent(currency);
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > exp) return null;
  const minor = Number((m[1] ?? "0") + frac.padEnd(exp, "0"));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export function minorToMajor(amountMinor: number, currency: string): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new ValidationError("amountMinor must be a positive integer");
  const exp = isoExponent(currency);
  return Number((amountMinor / 10 ** exp).toFixed(exp));
}

/**
 * API-confirmed payment -> ledger event. `verifiedBy: 'webhook'` is only legitimate because the
 * caller verified the notification signature AND this object came from GET /v1/payments/{id}.
 * Rejected / cancelled payments are ignored: the preference stays payable, so the attempt row
 * must stay pending. Dedupe per (payment id, status): replays are no-ops, transitions apply.
 */
export function mercadoPagoEvent(p: MercadoPagoPayment): VerifiedPaymentEvent {
  const dedupeKey = `mp:${p.id}:${p.status}`.slice(0, 255);
  const base = {
    dedupeKey,
    occurredAt: p.occurredAt,
    providerRef: p.externalReference ?? `mp_payment:${p.id}`,
    amountMinor: p.amountMinor,
    currency: p.currency,
    reference: p.reference,
    verifiedBy: "webhook" as const,
  };
  if (p.status === "approved") return { ...base, type: "payment.succeeded", paymentRef: p.id };
  if (p.status === "refunded" || p.status === "charged_back") return { ...base, type: "payment.refunded", fullyRefunded: true };
  return { dedupeKey, occurredAt: p.occurredAt, type: "ignored", eventType: `payment.${p.status}`.slice(0, 120) };
}

export interface MercadoPagoProviderOptions {
  accessToken: string;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  now?: () => number;
}

export interface MercadoPagoLinkInput extends CreatePaymentLinkInput {
  /** Our attempt reference, see buildExternalReference. Becomes `payments.provider_ref`. */
  externalReference: string;
  /** https URL MP posts payment notifications to (tenant webhook URL). */
  notificationUrl: string;
}

function isHttpsUrl(u: string): boolean {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}

export class MercadoPagoProvider {
  readonly name = "mercadopago";
  readonly #accessToken: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #now: () => number;

  constructor(o: MercadoPagoProviderOptions) {
    if (!o.accessToken) throw new ValidationError("Mercado Pago access token is required");
    this.#accessToken = o.accessToken;
    this.#fetch = o.fetch ?? globalThis.fetch;
    this.#baseUrl = (o.baseUrl ?? "https://api.mercadopago.com").replace(/\/+$/, "");
    this.#timeoutMs = o.timeoutMs ?? 15_000;
    this.#maxBytes = o.maxResponseBytes ?? 1024 * 1024;
    this.#now = o.now ?? Date.now;
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  /** Checkout Pro preference. `providerRef` returned is the external reference (not the preference id). */
  async createPaymentLink(input: MercadoPagoLinkInput): Promise<PaymentLink & { preferenceId: string }> {
    const currency = normalizeCurrency(input.currency);
    if (!input.description.trim()) throw new ValidationError("description is required");
    if (!isHttpsUrl(input.notificationUrl)) throw new ValidationError("notificationUrl must be https");
    if (!parseExternalReference(input.externalReference)) throw new ValidationError("Invalid external reference");
    const body: Record<string, unknown> = {
      items: [{ title: input.description.slice(0, 250), quantity: 1, unit_price: minorToMajor(input.amountMinor, currency), currency_id: currency }],
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      metadata: { tenant_id: input.reference.tenantId, kind: input.reference.kind, id: input.reference.id },
    };
    if (input.successUrl) {
      if (!isHttpsUrl(input.successUrl)) throw new ValidationError("successUrl must be https");
      body["back_urls"] = { success: input.successUrl };
      body["auto_return"] = "approved";
    }
    if (input.expiresAt) {
      body["expires"] = true;
      body["expiration_date_from"] = new Date(this.#now()).toISOString();
      body["expiration_date_to"] = input.expiresAt.toISOString();
    }
    const idem = createHash("sha256").update(input.externalReference).digest("hex").slice(0, 48);
    const res = (await this.#request("POST", "/checkout/preferences", JSON.stringify(body), `crmwsp-mp-${idem}`)) as Record<string, unknown>;
    const id = typeof res["id"] === "string" ? res["id"] : null;
    const url = typeof res["init_point"] === "string" ? res["init_point"] : null;
    if (!id || !url || !isHttpsUrl(url)) throw new PaymentProviderError("mercadopago", "Unexpected preference response", false);
    return { providerRef: input.externalReference, url, preferenceId: id, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) };
  }

  /** Source of truth for a notification: the payment as the MP API reports it. */
  async getPaymentById(paymentId: string): Promise<MercadoPagoPayment> {
    if (!/^\d{1,30}$/.test(paymentId)) throw new ValidationError("Invalid Mercado Pago payment id");
    const p = (await this.#request("GET", `/v1/payments/${paymentId}`)) as Record<string, unknown>;
    const id = typeof p["id"] === "number" || typeof p["id"] === "string" ? String(p["id"]) : null;
    const status = typeof p["status"] === "string" ? p["status"] : null;
    const currencyRaw = typeof p["currency_id"] === "string" ? p["currency_id"] : null;
    if (!id || id !== paymentId || !status || !currencyRaw) throw new PaymentProviderError("mercadopago", "Unexpected payment response", false);
    const currency = normalizeCurrency(currencyRaw);
    const amountMinor = majorToMinor(p["transaction_amount"], currency);
    if (amountMinor === null) throw new PaymentProviderError("mercadopago", "Unexpected payment amount", false);
    const externalReference = typeof p["external_reference"] === "string" ? p["external_reference"] : null;
    const when = typeof p["date_approved"] === "string" ? p["date_approved"] : typeof p["date_created"] === "string" ? p["date_created"] : null;
    const d = when ? new Date(when) : new Date(this.#now());
    return {
      id,
      status: status.slice(0, 40),
      amountMinor,
      currency,
      externalReference,
      reference: parseExternalReference(externalReference),
      occurredAt: Number.isNaN(d.getTime()) ? new Date(this.#now()) : d,
    };
  }

  async #request(method: "GET" | "POST", path: string, body?: string, idempotencyKey?: string): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#accessToken}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new PaymentProviderError("mercadopago", "Network error calling Mercado Pago", true);
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.#maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new PaymentProviderError("mercadopago", "Mercado Pago response exceeds size limit", false, { status: res.status });
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new PaymentProviderError("mercadopago", "Network error reading Mercado Pago response", true);
    }
    if (text.length > this.#maxBytes) throw new PaymentProviderError("mercadopago", "Mercado Pago response exceeds size limit", false, { status: res.status });
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new PaymentProviderError("mercadopago", `Mercado Pago responded with HTTP ${res.status}`, retryable, { status: res.status });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new PaymentProviderError("mercadopago", "Invalid JSON response from Mercado Pago", true, { status: res.status });
    }
  }
}
