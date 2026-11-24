import { describe, expect, it } from "vitest";
import { isoToLocalInput, localInputToIso } from "./datetime-local";

// The bug only shows when the browser zone differs from UTC (CI runs in UTC), so pin one.
process.env["TZ"] = "America/La_Paz";

describe("datetime-local conversions", () => {
  it("round-trips the wall time typed in the input", () => {
    for (const v of ["2026-11-24T00:00", "2026-12-01T00:00", "2026-03-29T12:30"]) {
      expect(isoToLocalInput(localInputToIso(v))).toBe(v);
    }
  });

  it("shows a stored instant in the browser's local wall time", () => {
    const iso = "2026-11-24T00:00:00.000Z";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(isoToLocalInput(iso)).toBe(expected);
  });

  it("keeps empty values empty", () => {
    expect(isoToLocalInput(null)).toBe("");
    expect(localInputToIso("")).toBeNull();
  });
});
