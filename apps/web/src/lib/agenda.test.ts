import { describe, expect, it } from "vitest";
import { END_OF_DAY, addDays, dateKeyInTz, endTimeFromInput, endTimeToInput, formatTimeIn, groupByDay, mondayOf, weekDates, zonedDayRange, zonedInstant, zonedMidnight } from "./agenda";

describe("end-of-day times (F10)", () => {
  it("round-trips 24:00 through the time input without becoming 23:59", () => {
    expect(endTimeToInput(END_OF_DAY)).toBe("00:00");
    expect(endTimeFromInput(endTimeToInput(END_OF_DAY))).toBe("24:00");
    expect(endTimeFromInput(endTimeToInput("23:59"))).toBe("23:59");
    expect(endTimeFromInput("18:30")).toBe("18:30");
  });
  it("24:00 of a day is midnight of the next one", () => {
    expect(zonedInstant("2026-03-02", END_OF_DAY, "UTC").toISOString()).toBe("2026-03-03T00:00:00.000Z");
    expect(zonedInstant("2026-03-02", END_OF_DAY, "America/Lima").toISOString()).toBe("2026-03-03T05:00:00.000Z");
  });
});

describe("zonedMidnight", () => {
  it("returns local midnight as a UTC instant", () => {
    expect(zonedMidnight("2026-03-02", "America/Lima").toISOString()).toBe("2026-03-02T05:00:00.000Z");
    expect(zonedMidnight("2026-03-02", "UTC").toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });
  it("accounts for daylight saving time", () => {
    expect(zonedMidnight("2026-07-01", "Europe/Madrid").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(zonedMidnight("2026-01-15", "Europe/Madrid").toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });
});

describe("zonedInstant", () => {
  it("converts a wall-clock time in the zone to a UTC instant", () => {
    expect(zonedInstant("2026-03-02", "14:30", "America/Lima").toISOString()).toBe("2026-03-02T19:30:00.000Z");
    expect(zonedInstant("2026-07-01", "09:00", "Europe/Madrid").toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });
});

describe("zonedDayRange", () => {
  it("spans exactly the local day, 23h on spring-forward days", () => {
    const r = zonedDayRange("2026-03-29", "Europe/Madrid");
    expect((Date.parse(r.to) - Date.parse(r.from)) / 3_600_000).toBe(23);
  });
});

describe("date helpers", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("finds the Monday of a week, with Sunday belonging to the previous Monday", () => {
    expect(mondayOf("2026-03-04")).toBe("2026-03-02");
    expect(mondayOf("2026-03-08")).toBe("2026-03-02");
    expect(mondayOf("2026-03-02")).toBe("2026-03-02");
  });
  it("lists the 7 dates of a week", () => {
    expect(weekDates("2026-03-02")).toEqual(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"]);
  });
});

describe("time zone formatting", () => {
  it("formats the time and the date key in the given zone", () => {
    expect(formatTimeIn("2026-03-02T14:30:00Z", "America/Lima")).toBe("09:30");
    expect(dateKeyInTz("2026-03-03T02:00:00Z", "America/Lima")).toBe("2026-03-02");
  });
  it("groups items by local day and sorts them by start", () => {
    const items = [
      { id: "b", startsAt: "2026-03-02T16:00:00Z", tz: "America/Lima" },
      { id: "a", startsAt: "2026-03-02T14:00:00Z", tz: "America/Lima" },
      { id: "c", startsAt: "2026-03-03T14:00:00Z", tz: "America/Lima" },
    ];
    const groups = groupByDay(items, (i) => i.startsAt, (i) => i.tz);
    expect(groups.map((g) => [g.date, g.items.map((i) => i.id)])).toEqual([
      ["2026-03-02", ["a", "b"]],
      ["2026-03-03", ["c"]],
    ]);
  });
});
