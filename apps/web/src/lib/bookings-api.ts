import {
  availabilityResponseSchema,
  availableSlotsResponseSchema,
  bookingListSchema,
  bookingResourceListSchema,
  bookingResourceSchema,
  bookingSchema,
  bookingServiceListSchema,
  bookingServiceSchema,
  timeOffListSchema,
  timeOffSchema,
  type AvailabilityWindow,
  type CreateBookingRequest,
  type CreateBookingResourceRequest,
  type CreateBookingServiceRequest,
  type CreateTimeOffRequest,
  type PatchBookingResourceRequest,
  type PatchBookingServiceRequest,
} from "@crmwsp/contracts";
import { request } from "./api";

/** Agenda: resources (people/rooms), services, weekly hours, time off and bookings. */
export const bookingsApi = {
  resources: () => request("/booking-resources", { schema: bookingResourceListSchema }),
  createResource: (input: CreateBookingResourceRequest) => request("/booking-resources", { method: "POST", body: input, schema: bookingResourceSchema }),
  patchResource: (id: string, input: PatchBookingResourceRequest) =>
    request(`/booking-resources/${id}`, { method: "PATCH", body: input, schema: bookingResourceSchema }),
  removeResource: (id: string) => request(`/booking-resources/${id}`, { method: "DELETE" }),

  weeklyHours: (resourceId: string) => request(`/booking-resources/${resourceId}/availability`, { schema: availabilityResponseSchema }),
  /** Replaces the whole weekly schedule of the resource. */
  putWeeklyHours: (resourceId: string, windows: AvailabilityWindow[]) =>
    request(`/booking-resources/${resourceId}/availability`, { method: "PUT", body: { windows }, schema: availabilityResponseSchema }),

  timeOff: (resourceId: string) => request(`/booking-resources/${resourceId}/time-off`, { schema: timeOffListSchema }),
  createTimeOff: (resourceId: string, input: CreateTimeOffRequest) =>
    request(`/booking-resources/${resourceId}/time-off`, { method: "POST", body: input, schema: timeOffSchema }),
  removeTimeOff: (resourceId: string, timeOffId: string) => request(`/booking-resources/${resourceId}/time-off/${timeOffId}`, { method: "DELETE" }),

  services: () => request("/booking-services", { schema: bookingServiceListSchema }),
  createService: (input: CreateBookingServiceRequest) => request("/booking-services", { method: "POST", body: input, schema: bookingServiceSchema }),
  patchService: (id: string, input: PatchBookingServiceRequest) =>
    request(`/booking-services/${id}`, { method: "PATCH", body: input, schema: bookingServiceSchema }),
  removeService: (id: string) => request(`/booking-services/${id}`, { method: "DELETE" }),

  /** Bookings overlapping [from, to) (max 62 days). */
  list: (q: { from: string; to: string; resourceId?: string | undefined }) => request("/bookings", { query: q, schema: bookingListSchema }),
  /** Free slots for a service in [from, to) (max 31 days), already net of hours, time off and bookings. */
  slots: (q: { serviceId: string; from: string; to: string; resourceId?: string | undefined; stepMinutes?: number | undefined }) =>
    request("/bookings/availability", { query: q, schema: availableSlotsResponseSchema }),
  create: (input: CreateBookingRequest) => request("/bookings", { method: "POST", body: input, schema: bookingSchema }),
  /** `lockVersion` is the one read with the booking: a stale value answers 409. */
  reschedule: (id: string, input: { startsAt: string; resourceId?: string | undefined; lockVersion: number }) =>
    request(`/bookings/${id}/reschedule`, { method: "POST", body: input, schema: bookingSchema }),
  transition: (id: string, action: "confirm" | "cancel" | "complete" | "no-show", input: { lockVersion: number; reason?: string | undefined }) =>
    request(`/bookings/${id}/${action}`, { method: "POST", body: input, schema: bookingSchema }),
};
