/**
 * Click-to-WhatsApp attribution and Meta Conversions API rules. Pure: no I/O, no hashing.
 */

export interface CurrencyMinor {
  currency: string;
  amountMinor: number;
}

/** ISO 4217 minor-unit exponent (JPY 0, EUR 2, KWD 3), from the platform's ICU data. */
export function currencyExponent(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Minor units → major-unit decimal number (Meta `custom_data.value`). */
export function minorToMajor(amountMinor: number, currency: string): number {
  const exp = currencyExponent(currency);
  return Number((amountMinor / 10 ** exp).toFixed(exp));
}

/**
 * Meta phone normalization before SHA-256: digits only, country code included, no "+" nor
 * leading zeros (https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters).
 * Returns undefined for anything that is not a plausible E.164 number.
 */
export function normalizePhoneForMeta(phoneE164: string): string | undefined {
  const digits = phoneE164.replace(/[^\d]/g, "").replace(/^0+/, "");
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : undefined;
}

/** Stable event ids shared with Meta for deduplication. */
export const leadEventId = (attributionId: string) => `lead:${attributionId}`;
export const purchaseEventId = (orderId: string) => `purchase:${orderId}`;

/** Meta rejects events older than 7 days; candidates older than this are never created. */
export const CAPI_MAX_EVENT_AGE_MS = 7 * 24 * 3600_000;
export const CAPI_MAX_ATTEMPTS = 6;

/** Exponential backoff for failed sends: 1, 2, 4, 8, 16 min… capped at 1 h. */
export function capiRetryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 3600_000);
}

/** HTTP statuses worth retrying (rate limit / transient server errors / network = 0). */
export function isRetryableCapiStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export interface AdReportInputRow {
  sourceId: string;
  headline: string | null;
  conversations: number;
  orders: number;
  /** Paid revenue (only orders paid with verified_by webhook | reconciliation), per currency. */
  revenue: CurrencyMinor[];
  spend: CurrencyMinor[];
}

export interface AdRoas {
  currency: string;
  revenueMinor: number;
  spendMinor: number;
  /** revenue / spend, null when there is no spend in that currency. */
  roas: number | null;
}

/** ROAS per currency; currencies are never mixed. */
export function computeRoas(revenue: CurrencyMinor[], spend: CurrencyMinor[]): AdRoas[] {
  const currencies = [...new Set([...revenue, ...spend].map((r) => r.currency))].sort();
  const sum = (rows: CurrencyMinor[], c: string) => rows.filter((r) => r.currency === c).reduce((a, r) => a + r.amountMinor, 0);
  return currencies.map((currency) => {
    const revenueMinor = sum(revenue, currency);
    const spendMinor = sum(spend, currency);
    return { currency, revenueMinor, spendMinor, roas: spendMinor > 0 ? Math.round((revenueMinor / spendMinor) * 100) / 100 : null };
  });
}
export * from "./recommendations.js";
