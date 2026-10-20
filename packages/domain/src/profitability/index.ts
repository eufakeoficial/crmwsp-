/**
 * Profitability rules (F7). Pure: no I/O. Usage costs are handled in USD micro-cents
 * (1 USD = 100_000_000), the unit the worker writes to `usage_ledger`, and converted to USD
 * cents only once per row so rounding never accumulates.
 */

export const USAGE_COST_CURRENCY = "USD" as const;
export const MICRO_PER_USD_CENT = 1_000_000;

const usd = (dollars: number): number => Math.round(dollars * 100_000_000);

/**
 * ESTIMATED WhatsApp cost per outbound template message (marketing category), USD micro-cents,
 * keyed by E.164 calling-code prefix; `default` applies when no prefix matches. Approximate public
 * Meta rates; tenants override them in `tenants.settings.profitability.whatsappRatesUsdMicro`.
 * Never use these to bill.
 */
export const DEFAULT_WHATSAPP_RATES_USD_MICRO: Readonly<Record<string, number>> = {
  "1": usd(0.025),
  "34": usd(0.0615),
  "51": usd(0.0703),
  "52": usd(0.0305),
  "54": usd(0.0618),
  "55": usd(0.0625),
  "56": usd(0.0889),
  "57": usd(0.0125),
  default: usd(0.05),
};

/** ESTIMATED TTS price, USD micro-cents per character (~$15 per 1M characters). */
export const DEFAULT_TTS_USD_MICRO_PER_CHAR = 1_500;

export type RateTable = Readonly<Record<string, number>>;

/**
 * Reads the tenant's rate table from `tenants.settings`. Invalid entries (non-numeric keys other
 * than `default`, negative or non-integer rates) are dropped; an empty result falls back to defaults.
 */
export function resolveWhatsappRates(settings: unknown): { rates: RateTable; source: "tenant" | "default" } {
  const raw = (settings as { profitability?: { whatsappRatesUsdMicro?: unknown } } | null)?.profitability?.whatsappRatesUsdMicro;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rates: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if ((k === "default" || /^\d{1,4}$/.test(k)) && typeof v === "number" && Number.isSafeInteger(v) && v >= 0) rates[k] = v;
    }
    if (Object.keys(rates).length > 0) {
      if (rates["default"] === undefined) rates["default"] = DEFAULT_WHATSAPP_RATES_USD_MICRO["default"] as number;
      return { rates, source: "tenant" };
    }
  }
  return { rates: DEFAULT_WHATSAPP_RATES_USD_MICRO, source: "default" };
}

/** Rate for an E.164 phone by longest calling-code prefix match. */
export function whatsappRateFor(phoneE164: string, rates: RateTable): number {
  const digits = phoneE164.replace(/^\+/, "");
  for (let len = Math.min(4, digits.length); len > 0; len--) {
    const r = rates[digits.slice(0, len)];
    if (r !== undefined) return r;
  }
  return rates["default"] ?? 0;
}

/** USD micro-cents to USD cents, rounded half up. */
export function microToCents(micro: number): number {
  return Math.round(micro / MICRO_PER_USD_CENT);
}

/**
 * Splits an integer amount into `n` integer shares that add up exactly to `amount`
 * (the remainder goes one unit at a time to the first shares).
 */
export function allocateEvenly(amount: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(amount / n);
  const rest = amount - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

export interface MarginInput {
  currency: string;
  revenueMinor: number;
  adSpendMinor: number;
  /** AI + TTS + WhatsApp in USD cents. */
  usageCostMinor: number;
}

/**
 * Margin in the report currency. Usage costs are USD; without FX they are only subtracted
 * when the report currency is USD.
 */
export function marginMinor(m: MarginInput): number {
  const usage = m.currency === USAGE_COST_CURRENCY ? m.usageCostMinor : 0;
  return m.revenueMinor - m.adSpendMinor - usage;
}

/** revenue / spend in basis points; null without spend. */
export function roasBp(revenueMinor: number, spendMinor: number): number | null {
  return spendMinor > 0 ? Math.round((revenueMinor * 10_000) / spendMinor) : null;
}

/** Integer average rounded half up; null when there is nothing to divide by. */
export function perUnit(totalMinor: number, units: number): number | null {
  return units > 0 ? Math.round(totalMinor / units) : null;
}
