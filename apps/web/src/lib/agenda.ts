import type { BookingStatus } from "@crmwsp/contracts";
import type { Tone } from "@/components/ui";

/** Date helpers for the agenda. Dates are "YYYY-MM-DD" keys; instants are ISO strings. */

const dayMs = 86_400_000;

function partsIn(at: Date, tz: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(at)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

/** Offset of `tz` from UTC at that instant (positive east of UTC). */
function tzOffsetMs(at: Date, tz: string): number {
  const p = partsIn(at, tz);
  return Date.UTC(p["year"]!, p["month"]! - 1, p["day"]!, p["hour"]!, p["minute"]!, p["second"]!) - Math.floor(at.getTime() / 1000) * 1000;
}

/** UTC instant of the wall-clock time `date` + "HH:MM" in `tz`. */
export function zonedInstant(date: string, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall - tzOffsetMs(new Date(wall), tz);
  t = wall - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** End-of-day bound of a weekly window (the API accepts "24:00"; <input type="time"> cannot show it). */
export const END_OF_DAY = "24:00";

/**
 * Value for an end-time <input type="time">: "24:00" is shown as "00:00". An END of 00:00 is never a
 * valid window (start < end), so "00:00" unambiguously means midnight at the end of the day.
 */
export function endTimeToInput(end: string): string {
  return end === END_OF_DAY ? "00:00" : end;
}

/** Inverse of endTimeToInput: "00:00" picked as an end time is stored as "24:00" (round trip). */
export function endTimeFromInput(value: string): string {
  return value === "00:00" ? END_OF_DAY : value;
}

/** UTC instant of 00:00 local time of `date` in `tz`. */
export function zonedMidnight(date: string, tz: string): Date {
  return zonedInstant(date, "00:00", tz);
}

/** [from, to) of a local day as ISO instants. */
export function zonedDayRange(date: string, tz: string): { from: string; to: string } {
  return { from: zonedMidnight(date, tz).toISOString(), to: zonedMidnight(addDays(date, 1), tz).toISOString() };
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * dayMs).toISOString().slice(0, 10);
}

/** Monday of the week containing `date` (weeks start on Monday). */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function todayKey(now: Date = new Date()): string {
  const p = partsIn(now, Intl.DateTimeFormat().resolvedOptions().timeZone);
  return `${p["year"]}-${String(p["month"]).padStart(2, "0")}-${String(p["day"]).padStart(2, "0")}`;
}

export function dateKeyInTz(iso: string, tz: string): string {
  const p = partsIn(new Date(iso), tz);
  return `${p["year"]}-${String(p["month"]).padStart(2, "0")}-${String(p["day"]).padStart(2, "0")}`;
}

/** "09:30" in the given zone (24h, as in the schedule editor). */
export function formatTimeIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** "lun, 2 mar" for a date key. */
export function formatDateKey(date: string): string {
  return new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function formatDateTimeIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("es", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function groupByDay<T>(items: readonly T[], startsAt: (i: T) => string, tz: (i: T) => string): { date: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => Date.parse(startsAt(a)) - Date.parse(startsAt(b)))) {
    const key = dateKeyInTz(startsAt(item), tz(item));
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, items: list }));
}

export const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;
/** Display order of the schedule editor (Monday first); values are the API weekday numbers. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const BOOKING_STATUS_LABELS: Readonly<Record<BookingStatus, string>> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Completada",
  no_show: "No asistió",
};
export const BOOKING_STATUS_TONES: Readonly<Record<BookingStatus, Tone>> = {
  pending: "warning",
  confirmed: "success",
  cancelled: "danger",
  completed: "info",
  no_show: "paper",
};
