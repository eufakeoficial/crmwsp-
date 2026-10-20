/**
 * Cost units. The worker writes `usage_ledger.cost_minor` in USD micro-cents (1e-8 USD,
 * `meta.unit = "usd_microcents"`) because per-call LLM costs are far below one cent; other
 * rows (e.g. WhatsApp fees) are in the minor unit of their own currency.
 */
export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** USD micro-cents to the minor unit of USD (cents): micro / 1e8 USD * 10^decimals. Rounded half up. */
export function usdMicrocentsToMinor(micro: number): number {
  return Math.round((micro * 10 ** currencyDecimals("USD")) / 1e8);
}

export interface KindUsage {
  kind: string;
  /** Total from tenant_monthly_spend for the reporting currency (mixed units). */
  total: number;
  /** Part of the USD total stored as micro-cents. */
  micro: number;
}

/**
 * Spend per kind in the reporting currency's minor units. Micro-cent rows are converted only
 * when reporting in USD; with another currency they are NOT converted (no FX): `currencyMismatch`.
 */
export function spendByKind(
  reportingCurrency: string,
  kinds: KindUsage[],
): { byKind: Array<{ kind: string; costMinor: number }>; currencyMismatch: boolean } {
  const usd = reportingCurrency === "USD";
  const byKind = kinds.map((k) => ({
    kind: k.kind,
    costMinor: usd ? k.total - k.micro + usdMicrocentsToMinor(k.micro) : k.total,
  }));
  return { byKind, currencyMismatch: !usd && kinds.some((k) => k.micro > 0) };
}
