import type { SalesMetricsDay } from "@crmwsp/contracts";

export const RANGE_OPTIONS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];

const DAY_MS = 86_400_000;

/** Inclusive [from, to] ending today (UTC calendar day of `now`) and spanning `days` days. */
export function rangeFor(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { from, to };
}

/** Bar height in 0..1 for each value, relative to the max (0 when all values are 0). */
export function barScale(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? v / max : 0));
}

/** Revenue of one day for a currency (0 when the day has none). */
export function dayRevenue(day: SalesMetricsDay, currency: string): number {
  return day.revenue.find((r) => r.currency === currency)?.amountMinor ?? 0;
}

/** 1234 -> "12,3 %". null -> "-". */
export function formatBp(bp: number | null, locale = "es"): string {
  if (bp === null) return "-";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bp / 100)} %`;
}
