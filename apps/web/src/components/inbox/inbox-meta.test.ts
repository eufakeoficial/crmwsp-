import { describe, expect, it } from "vitest";
import { compactRelative, folderCount, folderFixesStatus, folderParams, localInputToIso, localTimeIn, originLabel } from "./inbox-meta";

const NOW = new Date("2026-10-20T12:00:00Z");

describe("folderParams", () => {
  it("maps each folder to a list query", () => {
    expect(folderParams("all", "open")).toEqual({ status: "open" });
    expect(folderParams("all", "all")).toEqual({ status: "all" });
    expect(folderParams("closed", "open")).toEqual({ status: "closed" });
    expect(folderParams("mine", "open")).toEqual({ status: "open", assignedTo: "me" });
    expect(folderParams("unassigned", "closed")).toEqual({ status: "closed", assignedTo: "unassigned" });
    expect(folderParams("reminders", "open")).toEqual({ status: "all", reminders: true });
    expect(folderParams("tag:VIP: oro", "open")).toEqual({ status: "open", tag: "VIP: oro" });
  });
  it("knows which folders fix the status", () => {
    expect(folderFixesStatus("closed")).toBe(true);
    expect(folderFixesStatus("mine")).toBe(false);
  });
});

describe("compactRelative", () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  it("formats minutes, hours, days and weeks", () => {
    expect(compactRelative(ago(10_000), NOW)).toBe("ahora");
    expect(compactRelative(ago(5 * 60_000), NOW)).toBe("5m");
    expect(compactRelative(ago(8 * 3_600_000), NOW)).toBe("8h");
    expect(compactRelative(ago(26 * 3_600_000), NOW)).toBe("1d");
    expect(compactRelative(ago(15 * 86_400_000), NOW)).toBe("2sem");
  });
});

describe("folderCount", () => {
  const counts = { open: 4, closed: 9, unread: 2, mine: 1, unassigned: 3, remindersDue: 1, reminders: 2, tags: [{ name: "vip", count: 5 }] };
  it("reads each badge", () => {
    expect(folderCount(counts, "all")).toBe(2);
    expect(folderCount(counts, "reminders")).toBe(1);
    expect(folderCount(counts, "tag:vip")).toBe(5);
    expect(folderCount(counts, "tag:otra")).toBe(0);
    expect(folderCount(null, "all")).toBeNull();
  });
});

describe("contact panel helpers", () => {
  it("labels the lead origin", () => {
    expect(originLabel({ origin: "ad", ad: { sourceId: null, sourceType: null, sourceUrl: null, headline: "Oferta", firstSeenAt: NOW.toISOString() } })).toBe("Anuncio: Oferta");
    expect(originLabel({ origin: "import", ad: null })).toBe("Importado");
  });
  it("computes the contact local time and tolerates bad zones", () => {
    expect(localTimeIn("UTC", NOW)).toBe("12:00");
    expect(localTimeIn("Not/AZone", NOW)).toBeNull();
    expect(localTimeIn(null, NOW)).toBeNull();
  });
  it("converts a datetime-local value to ISO", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("2026-10-21T09:30")).toMatch(/^2026-10-21T\d{2}:30:00\.000Z$/);
  });
});
