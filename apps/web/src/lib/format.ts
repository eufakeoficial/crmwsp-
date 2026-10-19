/** Locale-aware formatters. Default locale is neutral Spanish; currency is always explicit (per tenant). */
const LOCALE = "es";

export function formatMoney(amount: number, currency: string, locale = LOCALE): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
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
