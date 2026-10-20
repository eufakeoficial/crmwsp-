import { describe, expect, it } from "vitest";
import { automationsPaused, pauseAfterAgentReply, pickRoundRobinAssignee, regionForPhone, reminderTime } from "./index.js";

const now = new Date("2026-10-20T12:00:00Z");

describe("reminderTime", () => {
  it("resolves presets relative to now", () => {
    expect(reminderTime("20m", now)).toEqual({ ok: true, remindAt: new Date("2026-10-20T12:20:00Z") });
    expect(reminderTime("12h", now)).toEqual({ ok: true, remindAt: new Date("2026-10-21T00:00:00Z") });
  });
  it("validates custom instants", () => {
    expect(reminderTime("custom", now)).toEqual({ ok: false, reason: "custom_required" });
    expect(reminderTime("custom", now, new Date("2026-10-20T11:00:00Z"))).toEqual({ ok: false, reason: "in_past" });
    expect(reminderTime("custom", now, new Date("2028-01-01T00:00:00Z"))).toEqual({ ok: false, reason: "too_far" });
    const at = new Date("2026-10-22T09:00:00Z");
    expect(reminderTime("custom", now, at)).toEqual({ ok: true, remindAt: at });
  });
});

describe("pickRoundRobinAssignee", () => {
  const t = (iso: string) => new Date(iso);
  it("picks the least loaded, then the longest waiting", () => {
    expect(
      pickRoundRobinAssignee(
        [
          { userId: "a", openCount: 2, lastAssignedAt: null },
          { userId: "b", openCount: 1, lastAssignedAt: t("2026-10-20T10:00:00Z") },
          { userId: "c", openCount: 1, lastAssignedAt: t("2026-10-20T09:00:00Z") },
        ],
        null,
      ),
    ).toBe("c");
    expect(
      pickRoundRobinAssignee(
        [
          { userId: "b", openCount: 0, lastAssignedAt: t("2026-10-20T10:00:00Z") },
          { userId: "a", openCount: 0, lastAssignedAt: null },
        ],
        null,
      ),
    ).toBe("a");
  });
  it("respects the per-agent cap", () => {
    expect(pickRoundRobinAssignee([{ userId: "a", openCount: 3, lastAssignedAt: null }], 3)).toBeNull();
    expect(pickRoundRobinAssignee([], null)).toBeNull();
  });
});

describe("automation pause", () => {
  it("is active only before the instant", () => {
    expect(automationsPaused(null, now)).toBe(false);
    expect(automationsPaused(new Date("2026-10-20T12:00:01Z"), now)).toBe(true);
    expect(automationsPaused(now, now)).toBe(false);
  });
  it("extends but never shortens on agent replies", () => {
    expect(pauseAfterAgentReply(null, now, 30)).toEqual(new Date("2026-10-20T12:30:00Z"));
    const later = new Date("2026-10-21T00:00:00Z");
    expect(pauseAfterAgentReply(later, now, 30)).toEqual(later);
    expect(pauseAfterAgentReply(null, now, 0)).toBeNull();
  });
});

describe("regionForPhone", () => {
  it("maps single-zone countries and leaves multi-zone ones without timezone", () => {
    expect(regionForPhone("+59171234567")).toEqual({ country: "BO", timezone: "America/La_Paz" });
    expect(regionForPhone("+34611111111")).toEqual({ country: "ES", timezone: "Europe/Madrid" });
    expect(regionForPhone("+5215512345678")).toEqual({ country: "MX", timezone: null });
    expect(regionForPhone("+14155550100")).toEqual({ country: "US", timezone: null });
    expect(regionForPhone("+999")).toEqual({ country: null, timezone: null });
  });
});
