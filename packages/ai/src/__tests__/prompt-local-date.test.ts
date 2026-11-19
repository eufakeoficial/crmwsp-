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
