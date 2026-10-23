import { describe, expect, it } from "vitest";
import { canTransitionBooking, checkSlot, computeAvailableSlots, isActiveBookingStatus, parseTimeOfDay, zonedTimeToUtc, type WeeklyWindow } from "./index.js";

const d = (iso: string): Date => new Date(iso);
const iso = (s: { startsAt: Date }): string => s.startsAt.toISOString();

// 2026-10-26 is a Monday (weekday 1).
const MON_9_13: WeeklyWindow = { weekday: 1, startTime: "09:00", endTime: "13:00" };
const LIMA = "America/Lima"; // UTC-5, no DST
const base = {
  availability: [MON_9_13],
  timeOff: [],
  bookings: [],
  service: { durationMinutes: 30, bufferMinutes: 0 },
  from: d("2026-10-26T00:00:00-05:00"),
  to: d("2026-10-27T00:00:00-05:00"),
  tz: LIMA,
  now: d("2026-10-20T00:00:00Z"),
  stepMinutes: 30,
};

describe("zonedTimeToUtc", () => {
  it("converts fixed-offset zones", () => {
    expect(zonedTimeToUtc(2026, 10, 26, 9 * 60, LIMA)?.toISOString()).toBe("2026-10-26T14:00:00.000Z");
  });
  it("returns null for times skipped by spring-forward and the earlier instant on fall-back", () => {
    // Madrid: 2026-03-29 02:00 -> 03:00; 2026-10-25 03:00 -> 02:00.
    expect(zonedTimeToUtc(2026, 3, 29, 2 * 60 + 30, "Europe/Madrid")).toBeNull();
    expect(zonedTimeToUtc(2026, 10, 25, 2 * 60 + 30, "Europe/Madrid")?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(zonedTimeToUtc(2026, 3, 29, 9 * 60, "Europe/Madrid")?.toISOString()).toBe("2026-03-29T07:00:00.000Z");
  });
});

describe("parseTimeOfDay", () => {
  it("parses HH:MM and HH:MM:SS, allows 24:00 and rejects junk", () => {
    expect(parseTimeOfDay("09:30")).toBe(570);
    expect(parseTimeOfDay("17:00:00")).toBe(1020);
    expect(parseTimeOfDay("24:00")).toBe(1440);
    expect(() => parseTimeOfDay("9:30")).toThrow(RangeError);
    expect(() => parseTimeOfDay("24:30")).toThrow(RangeError);
  });
});

describe("computeAvailableSlots", () => {
  it("emits step-aligned slots that fit entirely in the window", () => {
    const slots = computeAvailableSlots(base);
    expect(slots).toHaveLength(8);
    expect(iso(slots[0]!)).toBe("2026-10-26T14:00:00.000Z");
    expect(slots.at(-1)!.endsAt.toISOString()).toBe("2026-10-26T18:00:00.000Z");
  });

  it("does not emit slots whose duration overflows the window end", () => {
    const slots = computeAvailableSlots({ ...base, service: { durationMinutes: 45, bufferMinutes: 0 }, stepMinutes: 15 });
    expect(iso(slots.at(-1)!)).toBe("2026-10-26T17:15:00.000Z"); // 12:15-13:00 local
  });

  it("returns nothing on days without windows and for an empty range", () => {
    expect(computeAvailableSlots({ ...base, availability: [{ weekday: 2, startTime: "09:00", endTime: "10:00" }] })).toEqual([]);
    expect(computeAvailableSlots({ ...base, to: base.from })).toEqual([]);
  });

  it("drops past slots", () => {
    const slots = computeAvailableSlots({ ...base, now: d("2026-10-26T11:10:00-05:00") });
    expect(iso(slots[0]!)).toBe("2026-10-26T16:30:00.000Z"); // 11:30 local
  });

  it("drops slots overlapping time off", () => {
    const slots = computeAvailableSlots({ ...base, timeOff: [{ startsAt: d("2026-10-26T10:15:00-05:00"), endsAt: d("2026-10-26T11:00:00-05:00") }] });
    const starts = slots.map(iso);
    expect(starts).not.toContain("2026-10-26T15:00:00.000Z");
    expect(starts).not.toContain("2026-10-26T15:30:00.000Z");
    expect(starts).toContain("2026-10-26T16:00:00.000Z");
    expect(starts).toContain("2026-10-26T14:30:00.000Z");
  });

  it("respects existing bookings with their buffer and the candidate's own buffer", () => {
    const booked = { startsAt: d("2026-10-26T10:00:00-05:00"), endsAt: d("2026-10-26T10:30:00-05:00"), bufferMinutes: 15 };
    const slots = computeAvailableSlots({ ...base, bookings: [booked], service: { durationMinutes: 30, bufferMinutes: 15 }, stepMinutes: 15 });
    const starts = slots.map(iso);
    // 09:30 + 30 + 15 buffer = 10:15 > 10:00 -> conflict; 09:15 ends with buffer at 10:00 -> ok.
    expect(starts).toContain("2026-10-26T14:15:00.000Z");
    expect(starts).not.toContain("2026-10-26T14:30:00.000Z");
    // Booked 10:00-10:30 + 15 buffer -> first free start 10:45.
    expect(starts).not.toContain("2026-10-26T15:30:00.000Z");
    expect(starts).toContain("2026-10-26T15:45:00.000Z");
  });

  it("back-to-back slots are allowed without buffers (half-open intervals)", () => {
    const booked = { startsAt: d("2026-10-26T10:00:00-05:00"), endsAt: d("2026-10-26T10:30:00-05:00") };
    const starts = computeAvailableSlots({ ...base, bookings: [booked] }).map(iso);
    expect(starts).toContain("2026-10-26T14:30:00.000Z"); // 09:30-10:00
    expect(starts).toContain("2026-10-26T15:30:00.000Z"); // 10:30-11:00
    expect(starts).not.toContain("2026-10-26T15:00:00.000Z");
  });

  it("clips to [from, to)", () => {
    const starts = computeAvailableSlots({ ...base, from: d("2026-10-26T10:00:00-05:00"), to: d("2026-10-26T11:00:00-05:00") }).map(iso);
    expect(starts).toEqual(["2026-10-26T15:00:00.000Z", "2026-10-26T15:30:00.000Z"]);
  });

  it("uses local weekdays, not UTC ones", () => {
    // Monday 20:00-22:00 Lima = Tuesday 01:00-03:00 UTC.
    const starts = computeAvailableSlots({ ...base, availability: [{ weekday: 1, startTime: "20:00", endTime: "22:00" }], to: d("2026-10-27T12:00:00Z"), stepMinutes: 60 }).map(iso);
    expect(starts).toEqual(["2026-10-27T01:00:00.000Z", "2026-10-27T02:00:00.000Z"]);
  });

  it("handles DST: skips nonexistent local times and keeps wall-clock windows", () => {
    // Sunday 2026-03-29 Madrid, window 01:00-04:00, the 02:00-03:00 hour does not exist.
    const starts = computeAvailableSlots({
      ...base,
      availability: [{ weekday: 0, startTime: "01:00", endTime: "04:00" }],
      tz: "Europe/Madrid",
      from: d("2026-03-28T22:00:00Z"),
      to: d("2026-03-29T22:00:00Z"),
      now: d("2026-01-01T00:00:00Z"),
      stepMinutes: 30,
      service: { durationMinutes: 30, bufferMinutes: 0 },
    }).map(iso);
    // 01:00, 01:30 (CET=UTC+1) then 03:00, 03:30 (CEST=UTC+2). 01:30-02:00 wall end does not exist -> dropped.
    expect(starts).toEqual(["2026-03-29T00:00:00.000Z", "2026-03-29T01:00:00.000Z", "2026-03-29T01:30:00.000Z"]);
  });

  it("windows ending at 24:00 produce the last slot of the day", () => {
    const starts = computeAvailableSlots({ ...base, availability: [{ weekday: 1, startTime: "23:00", endTime: "24:00" }], to: d("2026-10-27T12:00:00Z") }).map(iso);
    expect(starts).toEqual(["2026-10-27T04:00:00.000Z", "2026-10-27T04:30:00.000Z"]);
  });

  it("merges multiple windows sorted and without duplicates", () => {
    const starts = computeAvailableSlots({
      ...base,
      availability: [{ weekday: 1, startTime: "15:00", endTime: "16:00" }, MON_9_13, { weekday: 1, startTime: "09:00", endTime: "10:00" }],
      stepMinutes: 60,
    }).map(iso);
    expect(starts).toEqual(["2026-10-26T14:00:00.000Z", "2026-10-26T15:00:00.000Z", "2026-10-26T16:00:00.000Z", "2026-10-26T17:00:00.000Z", "2026-10-26T20:00:00.000Z"]);
  });

  it("rejects invalid steps", () => {
    expect(() => computeAvailableSlots({ ...base, stepMinutes: 0 })).toThrow(RangeError);
  });
});

describe("checkSlot", () => {
  const c = { availability: [MON_9_13], timeOff: [], bookings: [], service: { durationMinutes: 30, bufferMinutes: 10 }, tz: LIMA, now: d("2026-10-20T00:00:00Z") };
  it("accepts any minute-aligned start inside a window", () => {
    expect(checkSlot({ ...c, startsAt: d("2026-10-26T09:07:00-05:00") })).toBeNull();
    expect(checkSlot({ ...c, startsAt: d("2026-10-26T12:30:00-05:00") })).toBeNull();
  });
  it("reports why a start is not bookable", () => {
    expect(checkSlot({ ...c, startsAt: d("2026-10-26T12:31:00-05:00") })).toBe("outside_hours");
    expect(checkSlot({ ...c, startsAt: d("2026-10-26T08:59:00-05:00") })).toBe("outside_hours");
    expect(checkSlot({ ...c, startsAt: d("2026-10-27T09:00:00-05:00") })).toBe("outside_hours");
    expect(checkSlot({ ...c, startsAt: d("2026-10-26T09:00:30-05:00") })).toBe("outside_hours");
    expect(checkSlot({ ...c, startsAt: d("2026-10-26T09:00:00-05:00"), now: d("2026-10-26T15:00:00Z") })).toBe("past");
    expect(checkSlot({ ...c, startsAt: d("2026-10-26T09:00:00-05:00"), timeOff: [{ startsAt: d("2026-10-26T09:20:00-05:00"), endsAt: d("2026-10-26T13:00:00-05:00") }] })).toBe("time_off");
    // Own buffer reaches into the next booking.
    expect(checkSlot({ ...c, startsAt: d("2026-10-26T09:00:00-05:00"), bookings: [{ startsAt: d("2026-10-26T09:35:00-05:00"), endsAt: d("2026-10-26T10:00:00-05:00") }] })).toBe("conflict");
  });
});

describe("booking status rules", () => {
  it("allows only forward transitions from active statuses", () => {
    expect(canTransitionBooking("pending", "confirmed")).toBe(true);
    expect(canTransitionBooking("confirmed", "no_show")).toBe(true);
    expect(canTransitionBooking("confirmed", "pending")).toBe(false);
    expect(canTransitionBooking("cancelled", "confirmed")).toBe(false);
    expect(canTransitionBooking("completed", "cancelled")).toBe(false);
    expect(canTransitionBooking("bogus", "cancelled")).toBe(false);
    expect(isActiveBookingStatus("pending")).toBe(true);
    expect(isActiveBookingStatus("no_show")).toBe(false);
  });
});
