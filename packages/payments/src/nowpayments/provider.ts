import { createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "@crmwsp/contracts";
import { InvalidSignatureError, PaymentProviderError } from "../errors.js";

/**
 * NOWPayments (crypto) for SaaS subscription charging only (ADR 0013): one-off invoices, no
 * provider-side recurring. Tenants charging their own customers never use this adapter.
 */

export const NOWPAYMENTS_DEFAULT_BASE_URL = "https://api.nowpayments.io/v1";
export const NOWPAYMENTS_DEFAULT_PAY_CURRENCY = "usdtbsc";
export const NOWPAYMENTS_SIGNATURE_HEADER = "x-nowpayments-sig";

/** Recursively sorts object keys (arrays keep their order), as NOWPayments does before signing. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Hex HMAC-SHA512 of the key-sorted JSON of the parsed IPN body. */
export function signNowPaymentsPayload(body: unknown, secret: string): string {
  return createHmac("sha512", secret).update(JSON.stringify(sortKeysDeep(body))).digest("hex");
}

/** Throws `InvalidSignatureError` unless `signature` matches. Constant time, length-checked. */
export function verifyNowPaymentsSignature(body: unknown, signature: string | string[] | undefined, secret: string): void {
  if (!secret) throw new InvalidSignatureError("IPN secret not configured");
  const sig = Array.isArray(signature) ? signature[0] : signature;
  if (typeof sig !== "string" || !/^[0-9a-fA-F]{128}$/.test(sig.trim())) throw new InvalidSignatureError();
  const expected = Buffer.from(signNowPaymentsPayload(body, secret), "hex");
  const given = Buffer.from(sig.trim().toLowerCase(), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new InvalidSignatureError();
}

/** Normalized view of an IPN body or a `GET /payment/{id}` response. */
export interface NowPaymentsPayment {
  paymentId: string;
  status: string;
  orderId: string | null;
  priceAmount: unknown;
  priceCurrency: string | null;
  payAmount: unknown;
  payCurrency: string | null;
  payAddress: string | null;
  actuallyPaid: unknown;
  payinHash: string | null;
}

function str(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

function idOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === "string" && /^\d{1,30}$/.test(v)) return v;
  return null;
}

/** Validates and normalizes a payment object. `payment_id` may be a number: normalized to string. */
export function parseNowPaymentsPayment(raw: unknown): NowPaymentsPayment {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PaymentProviderError("nowpayments", "Invalid NOWPayments payload", false);
  const r = raw as Record<string, unknown>;
  const paymentId = idOf(r["payment_id"]);
  const status = str(r["payment_status"], 40);
  if (!paymentId || !status) throw new PaymentProviderError("nowpayments", "Invalid NOWPayments payload", false);
  return {
    paymentId,
    status,
    orderId: str(r["order_id"], 100),
    priceAmount: r["price_amount"],
    priceCurrency: str(r["price_currency"], 20),
    payAmount: r["pay_amount"],
    payCurrency: str(r["pay_currency"], 20),
    payAddress: str(r["pay_address"], 200),
    actuallyPaid: r["actually_paid"],
    payinHash: str(r["payin_hash"], 200),
  };
}

export interface NowPaymentsProviderOptions {
  apiKey: string;
  baseUrl?: string;
  payCurrency?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface CreateNowPaymentInput {
  /** Our charge id; NOWPayments echoes it back as `order_id`. */
  orderId: string;
  /** Major units, e.g. "49.00". */
  priceAmount: string;
  priceCurrency: string;
  ipnCallbackUrl: string;
  description?: string;
}

export interface CreatedNowPayment {
  paymentId: string;
  payAddress: string;
  payAmount: string;
  payCurrency: string;
  status: string;
}

/** Builds options from env (`NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_API_BASE`, `NOWPAYMENTS_PAY_CURRENCY`). */
export function nowPaymentsOptionsFromEnv(env: Record<string, string | undefined>): NowPaymentsProviderOptions | null {
  const apiKey = env["NOWPAYMENTS_API_KEY"];
  if (!apiKey) return null;
  return {
    apiKey,
    ...(env["NOWPAYMENTS_API_BASE"] ? { baseUrl: env["NOWPAYMENTS_API_BASE"] } : {}),
    ...(env["NOWPAYMENTS_PAY_CURRENCY"] ? { payCurrency: env["NOWPAYMENTS_PAY_CURRENCY"] } : {}),
  };
}

export class NowPaymentsProvider {
  readonly name = "nowpayments";
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #payCurrency: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;

  constructor(o: NowPaymentsProviderOptions) {
    if (!o.apiKey) throw new ValidationError("NOWPayments API key is required");
    this.#apiKey = o.apiKey;
    this.#baseUrl = (o.baseUrl ?? NOWPAYMENTS_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#payCurrency = (o.payCurrency ?? NOWPAYMENTS_DEFAULT_PAY_CURRENCY).toLowerCase();
    this.#fetch = o.fetch ?? globalThis.fetch;
    this.#timeoutMs = o.timeoutMs ?? 15_000;
    this.#maxBytes = o.maxResponseBytes ?? 256 * 1024;
  }

  /** Never serializes the API key. */
  toJSON(): { name: string } {
    return { name: this.name };
  }

  get payCurrency(): string {
    return this.#payCurrency;
  }

  async createPayment(input: CreateNowPaymentInput): Promise<CreatedNowPayment> {
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(input.priceAmount)) throw new ValidationError("priceAmount must be a decimal");
    try {
      if (new URL(input.ipnCallbackUrl).protocol !== "https:") throw new Error("not https");
    } catch {
      throw new ValidationError("ipnCallbackUrl must be https");
    }
    const body = {
      price_amount: Number(input.priceAmount),
      price_currency: input.priceCurrency.toLowerCase(),
      pay_currency: this.#payCurrency,
      order_id: input.orderId,
      ipn_callback_url: input.ipnCallbackUrl,
      is_fixed_rate: true,
      ...(input.description ? { order_description: input.description.slice(0, 200) } : {}),
    };
    const res = parseNowPaymentsPayment(await this.#request("POST", "/payment", JSON.stringify(body)));
    const payAmount = typeof res.payAmount === "number" || typeof res.payAmount === "string" ? String(res.payAmount) : null;
    if (!res.payAddress || !payAmount || res.orderId !== input.orderId) {
      throw new PaymentProviderError("nowpayments", "Unexpected NOWPayments payment response", false);
    }
    return { paymentId: res.paymentId, payAddress: res.payAddress, payAmount, payCurrency: res.payCurrency ?? this.#payCurrency, status: res.status };
  }

  async getPayment(paymentId: string): Promise<NowPaymentsPayment> {
    if (!/^\d{1,30}$/.test(paymentId)) throw new ValidationError("Invalid NOWPayments payment id");
    const p = parseNowPaymentsPayment(await this.#request("GET", `/payment/${paymentId}`));
    if (p.paymentId !== paymentId) throw new PaymentProviderError("nowpayments", "Unexpected NOWPayments payment response", false);
    return p;
  }

  async #request(method: "GET" | "POST", path: string, body?: string): Promise<unknown> {
    const headers: Record<string, string> = { "x-api-key": this.#apiKey, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
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
      throw new PaymentProviderError("nowpayments", "Network error calling NOWPayments", true);
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new PaymentProviderError("nowpayments", "Network error reading NOWPayments response", true);
    }
    if (text.length > this.#maxBytes) throw new PaymentProviderError("nowpayments", "NOWPayments response exceeds size limit", false, { status: res.status });
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new PaymentProviderError("nowpayments", `NOWPayments responded with HTTP ${res.status}`, retryable, { status: res.status });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new PaymentProviderError("nowpayments", "Invalid JSON response from NOWPayments", true, { status: res.status });
    }
  }
}
