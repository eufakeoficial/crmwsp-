import { z } from "zod";
import { currencySchema, isoDateTimeSchema, uuidSchema } from "./common.js";

/** Appointment booking (agenda). Times of day are local "HH:MM" in the resource timezone. */

export const bookingStatusSchema = z.enum(["pending", "confirmed", "cancelled", "completed", "no_show"]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export const bookingSourceSchema = z.enum(["manual", "ai"]);
export type BookingSource = z.infer<typeof bookingSourceSchema>;
/** Statuses that occupy the resource (enforced by the DB exclusion constraint). */
export const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed"] as const satisfies readonly BookingStatus[];

/** IANA time zone accepted by the runtime (e.g. "America/Lima"). */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA time zone");

/** Local time of day "HH:MM" (00:00-23:59), or "24:00" as an end-of-day bound. */
export const timeOfDaySchema = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, "Expected HH:MM");

const nameSchema = z.string().trim().min(1).max(120);

// --- Resources -------------------------------------------------------------------

export const bookingResourceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  active: z.boolean(),
  timezone: z.string(),
  userId: uuidSchema.nullable(),
});
export type BookingResource = z.infer<typeof bookingResourceSchema>;
export const bookingResourceListSchema = z.object({ items: z.array(bookingResourceSchema) });

export const createBookingResourceRequestSchema = z.object({
  name: nameSchema,
  timezone: timeZoneSchema.optional(),
  userId: uuidSchema.nullable().optional(),
  active: z.boolean().optional(),
});
export type CreateBookingResourceRequest = z.infer<typeof createBookingResourceRequestSchema>;
export const patchBookingResourceRequestSchema = createBookingResourceRequestSchema.partial();
export type PatchBookingResourceRequest = z.infer<typeof patchBookingResourceRequestSchema>;

// --- Services --------------------------------------------------------------------

export const bookingServiceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  active: z.boolean(),
  priceMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
});
export type BookingService = z.infer<typeof bookingServiceSchema>;
export const bookingServiceListSchema = z.object({ items: z.array(bookingServiceSchema) });

const serviceFields = {
  name: nameSchema,
  durationMinutes: z.number().int().min(5).max(720),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  active: z.boolean().optional(),
  priceMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  currency: currencySchema.nullable().optional(),
};
const pricePair = (v: { priceMinor?: number | null | undefined; currency?: string | null | undefined }) =>
  (v.priceMinor === undefined) === (v.currency === undefined) && (v.priceMinor === null) === (v.currency === null);

export const createBookingServiceRequestSchema = z
  .object(serviceFields)
  .refine(pricePair, { message: "priceMinor and currency go together", path: ["currency"] });
export type CreateBookingServiceRequest = z.infer<typeof createBookingServiceRequestSchema>;
export const patchBookingServiceRequestSchema = z
  .object(serviceFields)
  .partial()
  .refine(pricePair, { message: "priceMinor and currency go together", path: ["currency"] });
export type PatchBookingServiceRequest = z.infer<typeof patchBookingServiceRequestSchema>;

// --- Weekly availability -----------------------------------------------------------

export const availabilityWindowSchema = z
  .object({
    /** 0 = Sunday ... 6 = Saturday. */
    weekday: z.number().int().min(0).max(6),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
  })
  .refine((w) => w.startTime < w.endTime && w.startTime !== "24:00", { message: "startTime must be before endTime", path: ["endTime"] });
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;

/** PUT replaces the whole weekly schedule of a resource. Windows of a weekday must not overlap. */
export const putAvailabilityRequestSchema = z
  .object({ windows: z.array(availabilityWindowSchema).max(100) })
  .refine(
    ({ windows }) => {
      const sorted = [...windows].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
      return sorted.every((w, i) => i === 0 || sorted[i - 1]!.weekday !== w.weekday || sorted[i - 1]!.endTime <= w.startTime);
    },
    { message: "Windows of the same weekday overlap", path: ["windows"] },
  );
export type PutAvailabilityRequest = z.infer<typeof putAvailabilityRequestSchema>;
export const availabilityResponseSchema = z.object({ resourceId: uuidSchema, windows: z.array(availabilityWindowSchema) });
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

// --- Time off ----------------------------------------------------------------------

export const timeOffSchema = z.object({
  id: uuidSchema,
  resourceId: uuidSchema,
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  reason: z.string().nullable(),
});
export type TimeOff = z.infer<typeof timeOffSchema>;
export const timeOffListSchema = z.object({ items: z.array(timeOffSchema) });

export const createTimeOffRequestSchema = z
  .object({ startsAt: isoDateTimeSchema, endsAt: isoDateTimeSchema, reason: z.string().trim().max(500).nullable().optional() })
  .refine((v) => Date.parse(v.startsAt) < Date.parse(v.endsAt), { message: "startsAt must be before endsAt", path: ["endsAt"] });
export type CreateTimeOffRequest = z.infer<typeof createTimeOffRequestSchema>;

// --- Bookings ------------------------------------------------------------------------

export const bookingSchema = z.object({
  id: uuidSchema,
  resourceId: uuidSchema,
  serviceId: uuidSchema,
  contactId: uuidSchema,
  conversationId: uuidSchema.nullable(),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  status: bookingStatusSchema,
  source: bookingSourceSchema,
  notes: z.string().nullable(),
  createdBy: uuidSchema.nullable(),
  lockVersion: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Booking = z.infer<typeof bookingSchema>;
export const bookingListSchema = z.object({ items: z.array(bookingSchema) });

export const createBookingRequestSchema = z.object({
  resourceId: uuidSchema,
  serviceId: uuidSchema,
  contactId: uuidSchema,
  conversationId: uuidSchema.nullable().optional(),
  startsAt: isoDateTimeSchema,
  status: z.enum(["pending", "confirmed"]).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type CreateBookingRequest = z.infer<typeof createBookingRequestSchema>;

export const rescheduleBookingRequestSchema = z.object({
  startsAt: isoDateTimeSchema,
  resourceId: uuidSchema.optional(),
  lockVersion: z.number().int().nonnegative(),
});
export type RescheduleBookingRequest = z.infer<typeof rescheduleBookingRequestSchema>;

/** Status transitions (confirm/cancel/complete/no_show) carry the version read by the client. */
export const bookingTransitionRequestSchema = z.object({
  lockVersion: z.number().int().nonnegative(),
  reason: z.string().trim().max(500).optional(),
});
export type BookingTransitionRequest = z.infer<typeof bookingTransitionRequestSchema>;

const MAX_RANGE_MS = 62 * 24 * 3600 * 1000;
const rangeOk = (v: { from: string; to: string }) => {
  const a = Date.parse(v.from);
  const b = Date.parse(v.to);
  return a < b && b - a <= MAX_RANGE_MS;
};

export const listBookingsQuerySchema = z
  .object({ from: isoDateTimeSchema, to: isoDateTimeSchema, resourceId: uuidSchema.optional() })
  .refine(rangeOk, { message: "from must be before to, at most 62 days apart", path: ["to"] });
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

export const availabilityQuerySchema = z
  .object({
    serviceId: uuidSchema,
    resourceId: uuidSchema.optional(),
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    stepMinutes: z.coerce.number().int().min(5).max(240).optional(),
  })
  .refine(
    (v) => {
      const a = Date.parse(v.from);
      const b = Date.parse(v.to);
      return a < b && b - a <= 31 * 24 * 3600 * 1000;
    },
    { message: "from must be before to, at most 31 days apart", path: ["to"] },
  );
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const availableSlotSchema = z.object({ resourceId: uuidSchema, startsAt: isoDateTimeSchema, endsAt: isoDateTimeSchema });
export type AvailableSlot = z.infer<typeof availableSlotSchema>;
export const availableSlotsResponseSchema = z.object({ serviceId: uuidSchema, slots: z.array(availableSlotSchema) });
export type AvailableSlotsResponse = z.infer<typeof availableSlotsResponseSchema>;
