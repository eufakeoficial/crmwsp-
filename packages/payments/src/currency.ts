import { ValidationError } from "@crmwsp/contracts";

/*
 * Our `amountMinor` follows ISO 4217 exponents. Stripe mostly agrees, with exceptions
 * (UNVERIFIED against docs.stripe.com, which was unreachable when written; from memory):
 *  - Stripe zero-decimal list: BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF.
 *    ISO says MGA has 2 decimals, so MGA is divided by 100 on the way out.
 *  - ISK and UGX: ISO exponent 0, but Stripe wants two-decimal amounts (multiples of 100): x100 on the way out.
 *  - Three-decimal (BHD JOD KWD OMR TND): same as ISO, but Stripe requires the last digit to be 0.
 * Anything else is two-decimal on both sides.
 */
const ISO_ZERO = new Set("BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF".split(" "));
const ISO_THREE = new Set("BHD IQD JOD KWD LYD OMR TND".split(" "));
const STRIPE_ZERO = new Set("BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF".split(" "));
const STRIPE_THREE_ROUND_10 = new Set("BHD JOD KWD OMR TND".split(" "));

export function normalizeCurrency(currency: string): string {
  const c = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new ValidationError("Invalid currency code");
  return c;
}

export function isoExponent(currency: string): number {
  const c = normalizeCurrency(currency);
  return ISO_ZERO.has(c) ? 0 : ISO_THREE.has(c) ? 3 : 2;
}

function stripeExponent(c: string): number {
  return STRIPE_ZERO.has(c) ? 0 : ISO_THREE.has(c) ? 3 : 2;
}

/** ISO minor units -> the integer Stripe expects. */
export function toStripeAmount(amountMinor: number, currency: string): number {
  const c = normalizeCurrency(currency);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new ValidationError("amountMinor must be a positive integer");
  }
  const diff = stripeExponent(c) - isoExponent(c);
  let out = amountMinor;
  if (diff > 0) out = amountMinor * 10 ** diff;
  else if (diff < 0) {
    const f = 10 ** -diff;
    if (amountMinor % f !== 0) throw new ValidationError(`Amount for ${c} must be a multiple of ${f}`);
    out = amountMinor / f;
  }
  if (STRIPE_THREE_ROUND_10.has(c) && out % 10 !== 0) {
    throw new ValidationError(`Amount for ${c} must be a multiple of 10 minor units`);
  }
  if (!Number.isSafeInteger(out)) throw new ValidationError("Amount too large");
  return out;
}

/** Integer reported by Stripe -> ISO minor units. */
export function fromStripeAmount(stripeAmount: number, currency: string): number {
  const c = normalizeCurrency(currency);
  const diff = stripeExponent(c) - isoExponent(c);
  return diff > 0 ? Math.round(stripeAmount / 10 ** diff) : diff < 0 ? stripeAmount * 10 ** -diff : stripeAmount;
}

/** Human formatting of ISO minor units (for payment instructions). */
export function formatMinor(amountMinor: number, currency: string, locale = "es-ES"): string {
  const c = normalizeCurrency(currency);
  const e = isoExponent(c);
  return new Intl.NumberFormat(locale, { style: "currency", currency: c, minimumFractionDigits: e, maximumFractionDigits: e }).format(
    amountMinor / 10 ** e,
  );
}
