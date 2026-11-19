import { describe, expect, it } from "vitest";
import { buildAiTurnMessages, renderLocalDate } from "../prompts/ai-turn.js";

// Thursday 2026-11-19, 21:30 in Lima (UTC-5) = 02:30Z on Friday.
const NOW = "2026-11-20T02:30:00.000Z";

describe("renderLocalDate", () => {
  it("resolves today and tomorrow in the tenant timezone", () => {
    expect(renderLocalDate(NOW, "America/Lima")).toBe(
      "Local date: Thursday 2026-11-19 21:30 (America/Lima). Tomorrow: Friday 2026-11-20.",
    );
  });

  it("uses a different weekday in another timezone at the same instant", () => {
    expect(renderLocalDate(NOW, "Europe/Madrid")).toMatch(/^Local date: Friday 2026-11-20 03:30 \(Europe\/Madrid\)\. Tomorrow: Saturday 2026-11-21\.$/);
  });

  it("Europe/Madrid DST end (25 h day): tomorrow is Monday, not Sunday again", () => {
    // 2026-10-25 lasts 25 h in Madrid: now + 24 h is still Sunday 23:30 local, so it would say "Sunday".
    expect(renderLocalDate("2026-10-24T22:30:00.000Z", "Europe/Madrid")).toBe(
      "Local date: Sunday 2026-10-25 00:30 (Europe/Madrid). Tomorrow: Monday 2026-10-26.",
    );
  });

  it("Europe/Madrid DST start: the 23 h day", () => {
    expect(renderLocalDate("2026-03-28T23:30:00.000Z", "Europe/Madrid")).toBe(
      "Local date: Sunday 2026-03-29 00:30 (Europe/Madrid). Tomorrow: Monday 2026-03-30.",
    );
  });

  it("America/Lima (no DST) late at night and across a month end", () => {
    expect(renderLocalDate("2026-12-01T04:59:00.000Z", "America/Lima")).toBe(
      "Local date: Monday 2026-11-30 23:59 (America/Lima). Tomorrow: Tuesday 2026-12-01.",
    );
  });

  it.each([undefined, "", "Mars/Olympus"])("falls back to UTC with a note for %s", (tz) => {
    const line = renderLocalDate(NOW, tz);
    expect(line).toContain("Friday 2026-11-20 02:30 (UTC)");
    expect(line).toContain("timezone is unknown");
  });

  it("refuses to resolve relative dates from an invalid instant", () => {
    expect(renderLocalDate("not-a-date", "America/Lima")).toMatch(/unknown/);
  });
});

describe("prompt grounding rules", () => {
  const system = buildAiTurnMessages({
    systemPrompt: "",
    tenantName: "Academia",
    conversation: [{ messageId: "m1", author: "contact", text: "¿Hay salsa hoy?" }],
    contact: {},
    retrievedChunks: [],
    nowIso: NOW,
    timeZone: "America/Lima",
  })[0]!.content;

  it("injects the local weekday", () => {
    expect(system).toContain("Local date: Thursday 2026-11-19 21:30 (America/Lima)");
  });

  it("forbids affirming facts absent from knowledge and guessing schedules", () => {
    expect(system).toMatch(/languages spoken, ages or age limits/);
    expect(system).toMatch(/say you do not have that information/);
    expect(system).toMatch(/covers THAT weekday; if it does not, say there is nothing that day/);
  });
});
