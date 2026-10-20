/** Number of minor-unit decimals for a currency (0 for CLP/JPY, 3 for KWD, ...). */
export function currencyDecimals(currency: string, locale = "en"): number {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/**
 * Formats an integer amount in minor units. Builds an exact decimal string
 * (no float division) and hands it to Intl, which accepts decimal strings.
 */
export function formatMoney(minor: number, currency: string, locale: string): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError("minor units must be a safe integer");
  const decimals = currencyDecimals(currency, locale);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(decimals + 1, "0");
  const int = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  const decimal = `${negative ? "-" : ""}${int}${decimals > 0 ? `.${frac}` : ""}`;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    decimal as unknown as number,
  );
}
