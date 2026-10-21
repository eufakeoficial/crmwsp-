import { MAX_METRICS_RANGE_DAYS, ValidationError } from "@crmwsp/contracts";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;

const toDay = (d: Date): string => d.toISOString().slice(0, 10);
const parseDay = (s: string): number => {
  const t = Date.parse(`${s}T00:00:00Z`);
  // Date.parse rolls over invalid days (2026-02-31 -> March), so round-trip to reject them.
  if (Number.isNaN(t) || toDay(new Date(t)) !== s) throw new ValidationError("Invalid date");
  return t;
};

/** Adds whole days to a `YYYY-MM-DD` day. */
export function addDays(day: string, n: number): string {
  return toDay(new Date(parseDay(day) + n * DAY_MS));
}

/** Resolves the inclusive [from, to] range. `today` is the tenant's current day. */
export function resolveRange(from: string | undefined, to: string | undefined, today: string): { from: string; to: string } {
  const end = to ?? today;
  const start = from ?? addDays(end, -(DEFAULT_DAYS - 1));
  const span = (parseDay(end) - parseDay(start)) / DAY_MS;
  if (span < 0) throw new ValidationError("'from' must not be after 'to'");
  if (span + 1 > MAX_METRICS_RANGE_DAYS) throw new ValidationError(`Range cannot exceed ${MAX_METRICS_RANGE_DAYS} days`);
  return { from: start, to: end };
}

/** Every day of the inclusive range, ascending. */
export function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = parseDay(from); t <= parseDay(to); t += DAY_MS) out.push(toDay(new Date(t)));
  return out;
}

/** buyers / leads in basis points, rounded; null when there are no leads. */
export function conversionBp(buyers: number, leads: number): number | null {
  return leads > 0 ? Math.round((buyers * 10_000) / leads) : null;
}
