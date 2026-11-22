import { ValidationError } from "@crmwsp/contracts";
import { encodeForm } from "../form-encode.js";
import { PaymentProviderError } from "../errors.js";

/**
 * Stripe Billing for SaaS subscription charging only (ADR 0022): Checkout in subscription mode,
 * customer portal and the customer record. Tenants charging THEIR customers use `StripeProvider`
 * with their own keys; this adapter uses the platform's key (`STRIPE_SECRET_KEY`) and never
 * serializes nor logs it. Talks plain HTTPS (no SDK dependency).
 */

export const STRIPE_BILLING_DEFAULT_BASE_URL = "https://api.stripe.com/v1";
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";

export interface StripeBillingOptions {
  secretKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/** Null (feature off) unless `STRIPE_SECRET_KEY` is set. */
export function stripeBillingOptionsFromEnv(env: Record<string, string | undefined>): StripeBillingOptions | null {
  const secretKey = env["STRIPE_SECRET_KEY"]?.trim();
  if (!secretKey) return null;
  return { secretKey, ...(env["STRIPE_API_BASE"] ? { baseUrl: env["STRIPE_API_BASE"] } : {}) };
}

export interface CreateStripeCustomerInput {
  tenantId: string;
  name?: string;
  email?: string;
}

export interface CreateCheckoutSessionInput {
  customerId: string;
  priceId: string;
  tenantId: string;
  plan: string;
  period: string;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeRedirect {
  id: string;
  url: string;
}

function assertHttps(url: string, label: string): void {
  try {
    if (new URL(url).protocol !== "https:") throw new Error("not https");
  } catch {
    throw new ValidationError(`${label} must be an https URL`);
  }
}

const ID_RE = /^[A-Za-z0-9_]{1,200}$/;

export class StripeBillingClient {
  readonly name = "stripe-billing";
  readonly #secretKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;

  constructor(o: StripeBillingOptions) {
    if (!o.secretKey) throw new ValidationError("Stripe secret key is required");
    this.#secretKey = o.secretKey;
    this.#baseUrl = (o.baseUrl ?? STRIPE_BILLING_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = o.fetch ?? globalThis.fetch;
    this.#timeoutMs = o.timeoutMs ?? 15_000;
    this.#maxBytes = o.maxResponseBytes ?? 512 * 1024;
  }

  /** Never serializes the secret key. */
  toJSON(): { name: string } {
    return { name: this.name };
  }

  /** Idempotent per tenant: a retried or concurrent call returns the same customer. */
  async createCustomer(input: CreateStripeCustomerInput): Promise<{ id: string }> {
    const res = await this.#post(
      "/customers",
      {
        ...(input.name ? { name: input.name.slice(0, 200) } : {}),
        ...(input.email ? { email: input.email.slice(0, 200) } : {}),
        metadata: { tenant_id: input.tenantId },
      },
      `crmwsp-customer-${input.tenantId}`,
    );
    const id = res["id"];
    if (typeof id !== "string" || !/^cus_[A-Za-z0-9]{1,100}$/.test(id)) throw new PaymentProviderError("stripe", "Unexpected Stripe customer response", false);
    return { id };
  }

  /** Checkout in subscription mode for one configured price. Promotion codes stay off (exact plan price). */
  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<StripeRedirect> {
    if (!ID_RE.test(input.priceId) || !/^cus_[A-Za-z0-9]{1,100}$/.test(input.customerId)) throw new ValidationError("Invalid Stripe identifiers");
    assertHttps(input.successUrl, "successUrl");
    assertHttps(input.cancelUrl, "cancelUrl");
    const metadata = { tenant_id: input.tenantId, plan: input.plan, period: input.period };
    const res = await this.#post("/checkout/sessions", {
      mode: "subscription",
      customer: input.customerId,
      client_reference_id: input.tenantId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: false,
      metadata,
      subscription_data: { metadata },
    });
    return this.#redirect(res, "cs_");
  }

  /** Customer portal link (update card, cancel, download invoices). */
  async createPortalSession(input: { customerId: string; returnUrl: string }): Promise<StripeRedirect> {
    if (!/^cus_[A-Za-z0-9]{1,100}$/.test(input.customerId)) throw new ValidationError("Invalid Stripe identifiers");
    assertHttps(input.returnUrl, "returnUrl");
    const res = await this.#post("/billing_portal/sessions", { customer: input.customerId, return_url: input.returnUrl });
    return this.#redirect(res, "bps_");
  }

  #redirect(res: Record<string, unknown>, prefix: string): StripeRedirect {
    const id = res["id"];
    const url = res["url"];
    if (typeof id !== "string" || !id.startsWith(prefix) || typeof url !== "string") {
      throw new PaymentProviderError("stripe", "Unexpected Stripe session response", false);
    }
    try {
      if (new URL(url).protocol !== "https:") throw new Error("not https");
    } catch {
      throw new PaymentProviderError("stripe", "Unexpected Stripe session response", false);
    }
    return { id, url };
  }

  async #post(path: string, data: Parameters<typeof encodeForm>[0], idempotencyKey?: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    };
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers,
        body: encodeForm(data),
        redirect: "error",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new PaymentProviderError("stripe", "Network error calling Stripe", true);
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new PaymentProviderError("stripe", "Network error reading Stripe response", true);
    }
    if (text.length > this.#maxBytes) throw new PaymentProviderError("stripe", "Stripe response exceeds size limit", false, { status: res.status });
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new PaymentProviderError("stripe", `Stripe responded with HTTP ${res.status}`, retryable, { status: res.status });
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return parsed as Record<string, unknown>;
    } catch {
      throw new PaymentProviderError("stripe", "Invalid JSON response from Stripe", true, { status: res.status });
    }
  }
}
