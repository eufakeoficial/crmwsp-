/*
 * Commerce connectors: store platforms (Shopify) and infoproduct platforms (Hotmart, Kiwify,
 * Eduzz, Gumroad, Payhip). Unlike @crmwsp/payments providers, CRMWSP does not create charges
 * here: it only RECEIVES sales that happened elsewhere. That is why this is a separate package
 * (different contract, different trust model) that reuses the payments currency helpers.
 */

export const commerceProviders = ["shopify", "hotmart", "kiwify", "eduzz", "gumroad", "payhip", "tiendanube", "woocommerce"] as const;
export type CommerceProvider = (typeof commerceProviders)[number];

export type CommerceEventType =
  | "order_created"
  | "order_paid"
  | "order_refunded"
  | "purchase_approved"
  | "purchase_refunded"
  | "product_updated"
  | "ignored";

/**
 * How the request was authenticated:
 *  - `hmac_body`: an HMAC over the raw body (integrity of amounts + authenticity);
 *  - `shared_token`: a static secret sent with the request (authenticity only, replayable,
 *    no body integrity). Never enough to touch a CRMWSP order.
 */
export type VerificationScheme = "hmac_body" | "shared_token";

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface Buyer {
  email: string | null;
  /** As sent by the provider (not normalized to E.164; the consumer normalizes). */
  phone: string | null;
  name: string | null;
}

export type ExternalSaleStatus = "pending" | "approved" | "refunded";

export interface NormalizedSale {
  /** Provider order / transaction id. Unique per (tenant, provider). */
  externalId: string;
  status: ExternalSaleStatus;
  /** ISO 4217 minor units per the PROVIDER; null when absent or unparseable. */
  amountMinor: number | null;
  /** Uppercase ISO 4217, or null. */
  currency: string | null;
  buyer: Buyer;
  productRef: string | null;
  productName: string | null;
  /** CRMWSP order id the merchant attached (Shopify note attribute `crmwsp_order_id`), if any. */
  crmwspOrderId: string | null;
  occurredAt: Date | null;
}

export interface CatalogVariant {
  externalId: string;
  sku: string | null;
  options: Record<string, string>;
  /** ISO minor units, null = product price. */
  priceMinor: number | null;
  compareAtMinor: number | null;
}

export interface CatalogProduct {
  externalId: string;
  name: string;
  description: string | null;
  active: boolean;
  /** Price of the first variant, ISO minor units. */
  priceMinor: number;
  variants: CatalogVariant[];
}

export interface NormalizedCommerceEvent {
  provider: CommerceProvider;
  /** Dedupe key per (tenant, provider). */
  eventId: string;
  type: CommerceEventType;
  /** Raw provider topic / event name (for audit). */
  providerEventType: string;
  verification: VerificationScheme;
  /**
   * False when the signing scheme is implemented from memory and was NOT checked against the
   * provider's current docs (marked `// UNVERIFIED` in the adapter).
   */
  schemeConfirmed: boolean;
  sale: NormalizedSale | null;
  product: CatalogProduct | null;
}

export interface VerifyContext {
  /** Query string of the webhook request (Kiwify signs into `?signature=`). */
  query?: Record<string, string | undefined>;
  /** Optional account identifier stored with the connection (Gumroad seller id). */
  accountRef?: string | null;
  /** Shop currency (Shopify order payloads carry it; products do not). */
  currency?: string | null;
}

export interface CatalogSource {
  /**
   * Store locator: Shopify `my-shop.myshopify.com`, Tiendanube numeric store id, WooCommerce
   * https site URL.
   */
  shopDomain: string;
  /** Shopify / Tiendanube API token; WooCommerce `consumer_key:consumer_secret`. */
  accessToken: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface CatalogPage {
  currency: string;
  products: CatalogProduct[];
}

export interface CommerceConnector {
  readonly provider: CommerceProvider;
  readonly verification: VerificationScheme;
  /**
   * True when the webhook is authenticated only by a static or semi-public value (no body
   * signature, no replay protection). The UI must warn; the API applies a tighter
   * per-connection rate limit and relies on event-id dedupe.
   */
  readonly weakAuth?: boolean;
  /**
   * Verifies the request with the tenant's secret and normalizes it. `rawBody` MUST be the exact
   * bytes received. Throws InvalidSignatureError (reject, 400) or CommercePayloadError (400).
   */
  verifyWebhook(rawBody: Uint8Array, headers: WebhookHeaders, secret: string, ctx?: VerifyContext): NormalizedCommerceEvent;
  /** Store platforms only: full catalog pull. */
  listProducts?(source: CatalogSource, fetchImpl: FetchLike): Promise<CatalogPage>;
}
