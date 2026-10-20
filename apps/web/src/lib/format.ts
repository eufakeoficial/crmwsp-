/** Locale-aware formatters. Default locale is neutral Spanish; currency is always explicit (per tenant). */
const LOCALE = "es";

/** Amount in major units (e.g. 12.5 EUR). The currency decides the decimals (CLP 0, EUR 2, KWD 3). */
export function formatMoney(amount: number, currency: string, locale = LOCALE): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

/** ISO 4217 decimals of a currency (CLP/JPY: 0, EUR/USD: 2, KWD/BHD: 3); 2 for unknown codes. */
export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Minor units (what the API stores) to major units, using the currency's decimals. Never divide by 100 by hand. */
export function minorToMajor(minor: number, currency: string): number {
  return minor / 10 ** currencyDecimals(currency);
}

/** Formats an amount in minor units: 1250 EUR -> "12,50 €", 1250 CLP -> "$1.250". */
export function formatMoneyMinor(minor: number, currency: string, locale = LOCALE): string {
  return formatMoney(minorToMajor(minor, currency), currency, locale);
}

/**
 * Money typed by the user ("12,50") to minor units of `currency`. Returns undefined for
 * invalid input, negatives, or more decimals than the currency has ("12,5" in CLP).
 * Digit-string arithmetic: no floating point rounding surprises.
 */
export function majorToMinor(input: string, currency: string): number | undefined {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(input.trim());
  if (!m) return undefined;
  const decimals = currencyDecimals(currency);
  const frac = m[2] ?? "";
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) return undefined;
  const minor = Number(`${m[1]}${frac.slice(0, decimals).padEnd(decimals, "0")}`);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

/** Minor units to the text shown in an input ("1250" -> "12.5" for EUR, "1250" for CLP). */
export function minorToInput(minor: number, currency: string): string {
  return String(minorToMajor(minor, currency));
}

export function formatNumber(value: number, locale = LOCALE): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(date: Date | string | number, locale = LOCALE): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(date),
  );
}

export function formatDateTime(date: Date | string | number, locale = LOCALE): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
}

/** "hace 5 min", "hace 2 h", "hace 3 d". */
export function formatRelative(date: Date | string | number, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(date).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** "14:05" in the viewer's time zone. */
export function formatTime(date: Date | string | number, locale = LOCALE): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

/** Day label for chat separators: "Hoy", "Ayer" or a short date. */
export function formatDayLabel(date: Date | string | number, now: Date = new Date(), locale = LOCALE): string {
  const d = new Date(date);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(d);
}
