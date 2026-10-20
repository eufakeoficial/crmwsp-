import { createHash } from "node:crypto";
import { ValidationError } from "@crmwsp/contracts";
import { normalizeCurrency, fromStripeAmount, toStripeAmount } from "../currency.js";
import { PaymentProviderError } from "../errors.js";
import { encodeForm } from "../form-encode.js";
import type {
  CreatePaymentLinkInput,
  PaymentLink,
  PaymentProvider,
  PaymentReference,
  PaymentSnapshot,
  VerifiedPaymentEvent,
  WebhookHeaders,
} from "../types.js";
import { normalizeStripeEvent } from "./events.js";
import { createSessionResponseSchema, errorBodySchema, sessionSchema } from "./schemas.js";
import { verifyStripeSignature } from "./signature.js";

/*
 * Stripe adapter over the REST API with plain fetch (no SDK): we control redirects
 * (`redirect:'error'`), timeouts, response size and secret handling, and every adapter
 * (Gupshup, Stripe...) shares one pattern. Flow: Checkout Sessions, mode=payment, inline price_data.
 * NOTE: docs.stripe.com was unreachable when written; parameters come from memory (unverified).
 */

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Used when `createPaymentLink` gets no `successUrl` (Stripe's hosted page requires one). */
  defaultSuccessUrl?: string;
  /** Optional `Stripe-Version` header. */
  apiVersion?: string;
  /** Max accepted response size in bytes (default 1 MiB). */
  maxResponseBytes?: number;
  /** Clock for the webhook tolerance check (tests). */
  now?: () => number;
}

const MIN_EXPIRY_S = 30 * 60;
const MAX_EXPIRY_S = 24 * 60 * 60;

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  // ES private fields: invisible to JSON.stringify, util.inspect and spreads.
  readonly #secretKey: string;
  readonly #webhookSecret: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #defaultSuccessUrl: string | undefined;
  readonly #apiVersion: string | undefined;
  readonly #maxBytes: number;
  readonly #now: () => number;

  constructor(options: StripeProviderOptions) {
    if (!options.secretKey || !options.webhookSecret) throw new ValidationError("Stripe credentials are required");
    this.#secretKey = options.secretKey;
    this.#webhookSecret = options.webhookSecret;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#baseUrl = (options.baseUrl ?? "https://api.stripe.com").replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#defaultSuccessUrl = options.defaultSuccessUrl;
    this.#apiVersion = options.apiVersion;
    this.#maxBytes = options.maxResponseBytes ?? 1024 * 1024;
    this.#now = options.now ?? Date.now;
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLink> {
    const currency = normalizeCurrency(input.currency);
    const unitAmount = toStripeAmount(input.amountMinor, currency);
    const successUrl = input.successUrl ?? this.#defaultSuccessUrl;
    if (!successUrl || !isHttpsUrl(successUrl)) throw new ValidationError("A valid https successUrl is required");
    if (!input.description.trim()) throw new ValidationError("description is required");

    let expiresAtSec: number | undefined;
    if (input.expiresAt) {
      expiresAtSec = Math.floor(input.expiresAt.getTime() / 1000);
      const delta = expiresAtSec - Math.floor(this.#now() / 1000);
      // Stripe: expires_at must be 30 min to 24 h after creation (unverified).
      if (delta < MIN_EXPIRY_S || delta > MAX_EXPIRY_S) {
        throw new ValidationError("expiresAt must be between 30 minutes and 24 hours from now");
      }
    }

    const ref = input.reference;
    const metadata = { tenantId: ref.tenantId, kind: ref.kind, id: ref.id };
    const body = encodeForm({
      mode: "payment",
      success_url: successUrl,
      client_reference_id: `${ref.tenantId}:${ref.kind}:${ref.id}`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: unitAmount,
            product_data: { name: input.description.slice(0, 250) },
          },
        },
      ],
      metadata,
      // Copied onto the PaymentIntent/Charge so refund events can be attributed.
      payment_intent_data: { metadata },
      expires_at: expiresAtSec,
    });

    const res = await this.#request("POST", "/v1/checkout/sessions", {
      body,
      idempotencyKey: idempotencyKey(ref, input.amountMinor, currency),
    });
    const parsed = createSessionResponseSchema.safeParse(res);
    if (!parsed.success || !isHttpsUrl(parsed.data.url)) {
      throw new PaymentProviderError("stripe", "Unexpected Checkout Session response", false);
    }
    return {
      providerRef: parsed.data.id,
      url: parsed.data.url,
      ...(parsed.data.expires_at ? { expiresAt: new Date(parsed.data.expires_at * 1000) } : {}),
    };
  }

  parseWebhook(rawBody: Uint8Array, headers: WebhookHeaders): VerifiedPaymentEvent[] {
    return parseStripeWebhook(rawBody, headers, this.#webhookSecret, this.#now());
  }

  async getPayment(providerRef: string): Promise<PaymentSnapshot> {
    if (!/^cs_[A-Za-z0-9_]+$/.test(providerRef)) throw new ValidationError("Invalid Stripe session reference");
    const json = await this.#request("GET", `/v1/checkout/sessions/${providerRef}`);
    const s = sessionSchema.safeParse(json);
    if (!s.success || !s.data.currency || s.data.amount_total == null) {
      throw new PaymentProviderError("stripe", "Unexpected Checkout Session response", false);
    }
    const session = s.data;
    const currency = session.currency!.toUpperCase();
    const md = session.metadata;
    const reference: PaymentReference | null =
      md?.tenantId && md.id && (md.kind === "order" || md.kind === "quote")
        ? { tenantId: md.tenantId, kind: md.kind, id: md.id }
        : null;
    return {
      providerRef: session.id,
      status: session.payment_status === "paid" ? "succeeded" : session.status === "expired" ? "expired" : "pending",
      amountMinor: fromStripeAmount(session.amount_total!, currency),
      currency,
      reference,
      verifiedBy: "reconciliation",
    };
  }

  async #request(method: "GET" | "POST", path: string, opts: { body?: string; idempotencyKey?: string } = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#secretKey}`,
      accept: "application/json",
    };
    if (this.#apiVersion) headers["stripe-version"] = this.#apiVersion;
    if (opts.body !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      // No `cause`: it could embed request details.
      throw new PaymentProviderError("stripe", "Network error calling Stripe", true);
    }

    let text: string;
    try {
      text = await readLimited(res, this.#maxBytes);
    } catch (e) {
      if (e instanceof PaymentProviderError) throw e;
      throw new PaymentProviderError("stripe", "Network error reading Stripe response", true);
    }

    if (!res.ok) {
      // 409 = idempotent request still in flight; 429/408/5xx are transient.
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408 || res.status === 409;
      let providerCode: string | undefined;
      try {
        const code = errorBodySchema.parse(JSON.parse(text)).error?.code;
        if (code && /^[a-z0-9_]{1,64}$/.test(code)) providerCode = code;
      } catch {
        /* body is not Stripe JSON; ignore */
      }
      throw new PaymentProviderError("stripe", `Stripe responded with HTTP ${res.status}`, retryable, {
        status: res.status,
        ...(providerCode ? { providerCode } : {}),
      });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new PaymentProviderError("stripe", "Invalid JSON response from Stripe", true, { status: res.status });
    }
  }
}

/**
 * Verifies the `Stripe-Signature` over the RAW body and normalizes the event. Standalone so a
 * webhook receiver only needs the webhook secret (not the API key). Throws InvalidSignatureError
 * before the body is parsed.
 */
export function parseStripeWebhook(
  rawBody: Uint8Array,
  headers: WebhookHeaders,
  webhookSecret: string,
  nowMs: number = Date.now(),
): VerifiedPaymentEvent[] {
  if (!webhookSecret) throw new ValidationError("Stripe webhook secret is required");
  verifyStripeSignature({ rawBody, header: headerValue(headers, "stripe-signature"), secret: webhookSecret, nowMs });
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new PaymentProviderError("stripe", "Webhook body is not valid JSON", false);
  }
  return [normalizeStripeEvent(json)];
}

function isHttpsUrl(u: string): boolean {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}

/** Same reference + amount + currency => same key, so retries never create a second link. */
export function idempotencyKey(ref: PaymentReference, amountMinor: number, currency: string): string {
  const h = createHash("sha256").update(`${ref.tenantId}|${ref.kind}|${ref.id}|${amountMinor}|${currency}`).digest("hex");
  return `crmwsp-pl-${h.slice(0, 48)}`;
}

function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

async function readLimited(res: Response, max: number): Promise<string> {
  const tooBig = () => new PaymentProviderError("stripe", "Stripe response exceeds size limit", false, { status: res.status });
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw tooBig();
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
