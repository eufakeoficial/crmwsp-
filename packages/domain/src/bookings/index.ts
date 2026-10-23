/*
 * Appointment availability. Pure: no clock, no I/O. Weekly windows are local wall-clock times in
 * the resource time zone; everything else is absolute instants. Intervals are half-open [start, end).
 *
 * Buffers: a booking occupies [startsAt, endsAt + bufferMinutes of its service). The DB exclusion
 * constraint only guards [startsAt, endsAt); the buffer is enforced here (the API runs this check
 * inside the transaction that locks the resource row).
 */

export interface WeeklyWindow {
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** "HH:MM" local, inclusive. */
  startTime: string;
  /** "HH:MM" local, exclusive; "24:00" means end of day. */
  endTime: string;
}

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

export interface BusyBooking extends Interval {
  /** Buffer after this booking (its service's buffer). Defaults to 0. */
  bufferMinutes?: number;
}

export interface SlotService {
  durationMinutes: number;
  bufferMinutes: number;
}

export interface ComputeSlotsInput {
  availability: readonly WeeklyWindow[];
  timeOff: readonly Interval[];
  /** Active (pending/confirmed) bookings of the same resource. */
  bookings: readonly BusyBooking[];
  service: SlotService;
  from: Date;
  to: Date;
  tz: string;
  now: Date;
  /** Granularity of candidate starts inside a window. Defaults to 15. */
  stepMinutes?: number;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

export function parseTimeOfDay(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(hhmm);
  if (!m) throw new RangeError(`invalid time of day: ${hhmm}`);
  const v = Number(m[1]) * 60 + Number(m[2]);
  if (v > 1440 || Number(m[2]) > 59) throw new RangeError(`invalid time of day: ${hhmm}`);
  return v;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  minutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

function localParts(t: number, tz: string): LocalParts & { seconds: number } {
  const parts = formatterFor(tz).formatToParts(new Date(t));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), minutes: get("hour") * 60 + get("minute"), seconds: get("second") };
}

/** Offset (local - UTC) in ms of `tz` at instant `t`. */
function offsetAt(t: number, tz: string): number {
  const p = localParts(t, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minutes, p.seconds);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/**
 * Instant of a local wall-clock time in `tz`. Returns null for times skipped by a DST jump.
 * For ambiguous times (DST fall-back) returns the earlier instant.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, minutes: number, tz: string): Date | null {
  const naive = Date.UTC(year, month - 1, day, 0, minutes);
  // Offsets around the instant; try both so ambiguous times resolve to the earlier one.
  const candidates = new Set([offsetAt(naive - DAY_MS / 2, tz), offsetAt(naive, tz), offsetAt(naive + DAY_MS / 2, tz)]);
  let best: number | null = null;
  for (const off of candidates) {
    const t = naive - off;
    const p = localParts(t, tz);
    if (p.year === year && p.month === month && p.day === day && p.minutes === minutes && (best === null || t < best)) best = t;
  }
  return best === null ? null : new Date(best);
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart < bEnd && bStart < aEnd;

export type SlotRejection = "past" | "outside_hours" | "time_off" | "conflict";

interface CheckContext {
  timeOff: readonly Interval[];
  bookings: readonly BusyBooking[];
  service: SlotService;
  now: Date;
}

function rejectBusy(start: number, ctx: CheckContext): SlotRejection | null {
  const end = start + ctx.service.durationMinutes * MINUTE;
  const paddedEnd = end + ctx.service.bufferMinutes * MINUTE;
  if (start < ctx.now.getTime()) return "past";
  for (const o of ctx.timeOff) if (overlaps(start, end, o.startsAt.getTime(), o.endsAt.getTime())) return "time_off";
  for (const b of ctx.bookings) {
    const bEnd = b.endsAt.getTime() + (b.bufferMinutes ?? 0) * MINUTE;
    if (overlaps(start, paddedEnd, b.startsAt.getTime(), bEnd)) return "conflict";
  }
  return null;
}

/** Local calendar days (y, m, d) whose wall-clock days intersect [from, to). */
function localDays(from: Date, to: Date, tz: string): Array<{ year: number; month: number; day: number }> {
  const first = localParts(from.getTime(), tz);
  const last = localParts(to.getTime() - 1, tz);
  const out: Array<{ year: number; month: number; day: number }> = [];
  let cur = Date.UTC(first.year, first.month - 1, first.day);
  const end = Date.UTC(last.year, last.month - 1, last.day);
  for (; cur <= end; cur += DAY_MS) {
    const d = new Date(cur);
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }
  return out;
}

const weekdayOf = (year: number, month: number, day: number): number => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

/**
 * Free start times for `service` in [from, to): each slot starts inside a weekly window at
 * `stepMinutes` offsets from the window start and the whole service duration fits in the window.
 * Slots in the past, touching time off, or colliding with a booking (buffers included) are dropped.
 */
export function computeAvailableSlots(input: ComputeSlotsInput): Slot[] {
  const step = input.stepMinutes ?? 15;
  if (!Number.isInteger(step) || step <= 0) throw new RangeError("stepMinutes must be a positive integer");
  const duration = input.service.durationMinutes;
  if (!(duration > 0)) throw new RangeError("durationMinutes must be positive");
  if (input.from.getTime() >= input.to.getTime()) return [];
  const ctx: CheckContext = { timeOff: input.timeOff, bookings: input.bookings, service: input.service, now: input.now };
  const fromMs = input.from.getTime();
  const toMs = input.to.getTime();
  const seen = new Set<number>();
  const slots: Slot[] = [];
  for (const { year, month, day } of localDays(input.from, input.to, input.tz)) {
    const wd = weekdayOf(year, month, day);
    for (const w of input.availability) {
      if (w.weekday !== wd) continue;
      const wStart = parseTimeOfDay(w.startTime);
      const wEnd = parseTimeOfDay(w.endTime);
      for (let m = wStart; m + duration <= wEnd; m += step) {
        const startDate = zonedTimeToUtc(year, month, day, m, input.tz);
        if (!startDate) continue; // skipped by DST
        const start = startDate.getTime();
        const end = start + duration * MINUTE;
        // A DST jump inside the slot changes its real length; require the wall-clock end to match.
        const endWall = zonedTimeToUtc(year, month, day, m + duration, input.tz);
        if (m + duration < 1440 && (!endWall || endWall.getTime() !== end)) continue;
        if (start < fromMs || start >= toMs || seen.has(start)) continue;
        if (rejectBusy(start, ctx)) continue;
        seen.add(start);
        slots.push({ startsAt: startDate, endsAt: new Date(end) });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export interface CheckSlotInput {
  availability: readonly WeeklyWindow[];
  timeOff: readonly Interval[];
  bookings: readonly BusyBooking[];
  service: SlotService;
  startsAt: Date;
  tz: string;
  now: Date;
}

/**
 * Validates one requested start (not necessarily step-aligned): it must be in the future, fully
 * inside one weekly window of its local day, and free of time off and bookings (buffers included).
 * Returns null when bookable, otherwise the first reason it is not.
 */
export function checkSlot(input: CheckSlotInput): SlotRejection | null {
  const start = input.startsAt.getTime();
  const p = localParts(start, input.tz);
  const wd = weekdayOf(p.year, p.month, p.day);
  const startWall = p.minutes;
  const endMs = start + input.service.durationMinutes * MINUTE;
  if (start < input.now.getTime()) return "past";
  if (p.seconds !== 0 || start % 1000 !== 0) return "outside_hours";
  const inWindow = input.availability.some((w) => {
    if (w.weekday !== wd) return false;
    const ws = parseTimeOfDay(w.startTime);
    const we = parseTimeOfDay(w.endTime);
    if (startWall < ws) return false;
    const endWall = startWall + input.service.durationMinutes;
    if (endWall > we) return false;
    const endInstant = endWall >= 1440 ? null : zonedTimeToUtc(p.year, p.month, p.day, endWall, input.tz);
    return endWall >= 1440 ? endWall === we : endInstant !== null && endInstant.getTime() === endMs;
  });
  if (!inWindow) return "outside_hours";
  return rejectBusy(start, { timeOff: input.timeOff, bookings: input.bookings, service: input.service, now: input.now });
}

/** Allowed status transitions of a booking. Terminal: cancelled, completed, no_show. */
const TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["confirmed", "cancelled", "completed", "no_show"],
  confirmed: ["cancelled", "completed", "no_show"],
  cancelled: [],
  completed: [],
  no_show: [],
};

export function canTransitionBooking(from: string, to: string): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Only active bookings can be rescheduled. */
export const isActiveBookingStatus = (s: string): boolean => s === "pending" || s === "confirmed";
