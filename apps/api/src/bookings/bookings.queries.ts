import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type Booking,
  type BookingResource,
  type BookingService,
  type TimeOff,
} from "@crmwsp/contracts";
import {
  and,
  bookingAvailability,
  bookingResources,
  bookingServices,
  bookings,
  bookingTimeOff,
  eq,
  gt,
  inArray,
  lt,
  ne,
  type Transaction,
} from "@crmwsp/db";
import { checkSlot, type BusyBooking, type Interval, type SlotRejection, type WeeklyWindow } from "@crmwsp/domain";
import { pgCode } from "../inbox/audit.js";
import { toNum } from "../sales/util.js";

export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_FK_VIOLATION = "23503";
const DAY_MS = 24 * 3600 * 1000;

type ResourceRow = typeof bookingResources.$inferSelect;
type ServiceRow = typeof bookingServices.$inferSelect;
type BookingRow = typeof bookings.$inferSelect;

export const toResource = (r: ResourceRow): BookingResource => ({ id: r.id, name: r.name, active: r.active, timezone: r.timezone, userId: r.userId });

export const toService = (s: ServiceRow): BookingService => ({
  id: s.id,
  name: s.name,
  durationMinutes: s.durationMinutes,
  bufferMinutes: s.bufferMinutes,
  active: s.active,
  priceMinor: toNum(s.priceMinor),
  currency: s.currency,
});

export const toTimeOff = (t: typeof bookingTimeOff.$inferSelect): TimeOff => ({
  id: t.id,
  resourceId: t.resourceId,
  startsAt: t.startsAt.toISOString(),
  endsAt: t.endsAt.toISOString(),
  reason: t.reason,
});

export const toBooking = (b: BookingRow): Booking => ({
  id: b.id,
  resourceId: b.resourceId,
  serviceId: b.serviceId,
  contactId: b.contactId,
  conversationId: b.conversationId,
  startsAt: b.startsAt.toISOString(),
  endsAt: b.endsAt.toISOString(),
  status: b.status,
  source: b.source,
  notes: b.notes,
  createdBy: b.createdBy,
  lockVersion: b.lockVersion,
  createdAt: b.createdAt.toISOString(),
  updatedAt: b.updatedAt.toISOString(),
});

/** Postgres `time` comes back as "HH:MM:SS"; the API speaks "HH:MM". */
export const hhmm = (t: string): string => t.slice(0, 5);
/** "HH:MM" -> PG `time`. "24:00" (end of day) maps to 24:00:00, which PG accepts. */
export const toPgTime = (t: string): string => `${t}:00`;

export async function loadResource(tx: Transaction, id: string, opts: { lock?: boolean } = {}): Promise<ResourceRow> {
  const q = tx.select().from(bookingResources).where(eq(bookingResources.id, id));
  const [r] = opts.lock ? await q.for("update") : await q;
  if (!r) throw new NotFoundError();
  return r;
}

export async function loadService(tx: Transaction, id: string): Promise<ServiceRow> {
  const [s] = await tx.select().from(bookingServices).where(eq(bookingServices.id, id));
  if (!s) throw new NotFoundError();
  return s;
}

export async function loadWindows(tx: Transaction, resourceIds: string[]): Promise<Map<string, WeeklyWindow[]>> {
  const out = new Map<string, WeeklyWindow[]>(resourceIds.map((id) => [id, []]));
  if (resourceIds.length === 0) return out;
  const rows = await tx.select().from(bookingAvailability).where(inArray(bookingAvailability.resourceId, resourceIds));
  for (const r of rows) out.get(r.resourceId)?.push({ weekday: r.weekday, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) });
  return out;
}

/** Time off and active bookings (with their service buffer) of `resourceIds` near [from, to). */
export async function loadBusy(
  tx: Transaction,
  resourceIds: string[],
  from: Date,
  to: Date,
  excludeBookingId?: string,
): Promise<Map<string, { timeOff: Interval[]; bookings: BusyBooking[] }>> {
  const out = new Map<string, { timeOff: Interval[]; bookings: BusyBooking[] }>(resourceIds.map((id) => [id, { timeOff: [], bookings: [] }]));
  if (resourceIds.length === 0) return out;
  // Buffers are at most 240 minutes; one day of margin covers them.
  const lo = new Date(from.getTime() - DAY_MS);
  const hi = new Date(to.getTime() + DAY_MS);
  const offs = await tx
    .select()
    .from(bookingTimeOff)
    .where(and(inArray(bookingTimeOff.resourceId, resourceIds), lt(bookingTimeOff.startsAt, hi), gt(bookingTimeOff.endsAt, lo)));
  for (const o of offs) out.get(o.resourceId)?.timeOff.push({ startsAt: o.startsAt, endsAt: o.endsAt });
  const conds = [
    inArray(bookings.resourceId, resourceIds),
    inArray(bookings.status, ["pending", "confirmed"]),
    lt(bookings.startsAt, hi),
    gt(bookings.endsAt, lo),
  ];
  if (excludeBookingId) conds.push(ne(bookings.id, excludeBookingId));
  const rows = await tx
    .select({ resourceId: bookings.resourceId, startsAt: bookings.startsAt, endsAt: bookings.endsAt, bufferMinutes: bookingServices.bufferMinutes })
    .from(bookings)
    .innerJoin(bookingServices, eq(bookingServices.id, bookings.serviceId))
    .where(and(...conds));
  for (const b of rows) out.get(b.resourceId)?.bookings.push({ startsAt: b.startsAt, endsAt: b.endsAt, bufferMinutes: b.bufferMinutes });
  return out;
}

const REJECTION_MESSAGES: Record<SlotRejection, string> = {
  past: "The requested time is in the past",
  outside_hours: "The requested time is outside the resource's working hours",
  time_off: "The resource is not available at the requested time",
  conflict: "The requested time overlaps another booking",
};

/**
 * Validates that `service` can start at `startsAt` on `resource`. The caller must hold the
 * resource row lock (FOR UPDATE) so concurrent bookings of the same resource serialize; the DB
 * exclusion constraint is the last line of defense for hard overlaps.
 */
export async function assertBookable(
  tx: Transaction,
  resource: ResourceRow,
  service: ServiceRow,
  startsAt: Date,
  now: Date,
  excludeBookingId?: string,
): Promise<Date> {
  if (!resource.active) throw new ValidationError("The resource is inactive");
  if (!service.active) throw new ValidationError("The service is inactive");
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
  const windows = (await loadWindows(tx, [resource.id])).get(resource.id) ?? [];
  const busy = (await loadBusy(tx, [resource.id], startsAt, endsAt, excludeBookingId)).get(resource.id) ?? { timeOff: [], bookings: [] };
  const rejection = checkSlot({
    availability: windows,
    timeOff: busy.timeOff,
    bookings: busy.bookings,
    service: { durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes },
    startsAt,
    tz: resource.timezone,
    now,
  });
  if (rejection === "conflict") throw new ConflictError(REJECTION_MESSAGES.conflict);
  if (rejection) throw new ValidationError(REJECTION_MESSAGES[rejection]);
  return endsAt;
}

/** Maps the DB overlap guard to a 409 instead of a 500. */
export function rethrowOverlap(err: unknown): never {
  if (pgCode(err) === PG_EXCLUSION_VIOLATION) throw new ConflictError(REJECTION_MESSAGES.conflict);
  throw err;
}
