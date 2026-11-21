import { describe, expect, it } from "vitest";
import { COMMON_TIMEZONES, formatZoneTime, suggestedZone, timezoneOptions } from "./company-timezone";

describe("company-timezone", () => {
  it("puts common zones first without duplicates and keeps the current zone", () => {
    const { common, others } = timezoneOptions("Pacific/Weird", ["Asia/Tokyo", "America/Lima", "Africa/Cairo"]);
    expect(common).toEqual([...COMMON_TIMEZONES]);
    expect(others).toEqual(["Africa/Cairo", "Asia/Tokyo", "Pacific/Weird"]);
  });
  it("formats local time and rejects bad zones", () => {
    expect(formatZoneTime("America/Lima", new Date("2026-01-01T02:40:00Z"))).toBe("21:40");
    expect(formatZoneTime("Nope/Zone", new Date())).toBeNull();
  });
  it("suggests the browser zone only when valid and different", () => {
    expect(suggestedZone("America/Lima", "Europe/Madrid")).toBe("America/Lima");
    expect(suggestedZone("America/Lima", "America/Lima")).toBeNull();
    expect(suggestedZone(undefined, "Europe/Madrid")).toBeNull();
    expect(suggestedZone("Nope/Zone", "Europe/Madrid")).toBeNull();
  });
});
