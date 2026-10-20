/** What a payment is for. The consumer (API) resolves it to an order or a quote. */
export interface PaymentReference {
  tenantId: string;
  kind: "order" | "quote";
  id: string;
}

export interface CreatePaymentLinkInput {
  /** Amount in ISO 4217 minor units (EUR cents, CLP pesos, JPY yen, KWD fils...). */
  amountMinor: number;
  /** ISO 4217 code, any case. */
  currency: string;
  description: string;
  reference: PaymentReference;
  successUrl?: string;
  expiresAt?: Date;
}

export interface PaymentLink {
  providerRef: string;
  url: string;
  expiresAt?: Date;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

interface EventBase {
  /** Idempotency key for `inbound_events.dedupe_key`. */
  dedupeKey: string;
  occurredAt: Date;
}

interface PaymentEventBase extends EventBase {
  /** Provider's id of the payment object (Stripe: Checkout Session id). */
  providerRef: string;
  /** Amount per the PROVIDER, in ISO minor units. The consumer MUST compare it with the order/quote. */
  amountMinor: number;
  /** Uppercase ISO 4217. */
  currency: string;
  /** Taken from provider metadata; null if the provider did not carry it. */
  reference: PaymentReference | null;
  /** Provenance for the `paid` rule: webhook events are signature-verified. */
  verifiedBy: "webhook";
}

export type VerifiedPaymentEvent =
  | (PaymentEventBase & { type: "payment.succeeded"; paymentRef?: string })
  | (PaymentEventBase & { type: "payment.failed" })
  | (PaymentEventBase & { type: "payment.expired" })
  /** `amountMinor` is the cumulative refunded amount; `providerRef` is the PaymentIntent id. */
  | (PaymentEventBase & { type: "payment.refunded"; fullyRefunded: boolean })
  | (EventBase & { type: "ignored"; eventType: string });

export interface PaymentSnapshot {
  providerRef: string;
  status: "succeeded" | "pending" | "expired";
  amountMinor: number;
  currency: string;
  reference: PaymentReference | null;
  /** Fetched from the provider API by us, so it counts as reconciliation. */
  verifiedBy: "reconciliation";
}

export interface PaymentProvider {
  readonly name: string;
  createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLink>;
  /** Verifies the signature over the RAW body. Throws InvalidSignatureError. */
  parseWebhook(rawBody: Uint8Array, headers: WebhookHeaders): VerifiedPaymentEvent[];
  getPayment(providerRef: string): Promise<PaymentSnapshot>;
}
