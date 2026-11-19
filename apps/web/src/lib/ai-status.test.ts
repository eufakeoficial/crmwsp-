import { describe, expect, it } from "vitest";
import { computeAiStatus, isPausedAt, listAiTone } from "./ai-status";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const base = { aiMode: "auto", status: "open", inboxStatus: "open", assigneeName: null, pausedUntil: null } as const;

describe("computeAiStatus", () => {
  it("closed wins over everything", () => {
    const s = computeAiStatus({ ...base, inboxStatus: "closed", status: "pending", assigneeName: "Ana" }, NOW);
    expect(s).toMatchObject({ kind: "closed", tone: "gray", label: "Chat cerrado" });
    expect(computeAiStatus({ ...base, status: "resolved" }, NOW).kind).toBe("closed");
  });
  it("pending is handoff, above assignee", () => {
    const s = computeAiStatus({ ...base, status: "pending", assigneeName: "Ana" }, NOW);
    expect(s).toMatchObject({ kind: "handoff", tone: "amber", label: "Necesita atención: la IA derivó a una persona" });
  });
  it("assigned beats aiMode", () => {
    const s = computeAiStatus({ ...base, aiMode: "off", assigneeName: "Ana" }, NOW);
    expect(s).toMatchObject({ kind: "assigned", tone: "amber", label: "Atendido por Ana: la IA no responde" });
  });
  it("off, assist", () => {
    expect(computeAiStatus({ ...base, aiMode: "off" }, NOW)).toMatchObject({ kind: "off", tone: "gray", label: "IA apagada en este chat" });
    expect(computeAiStatus({ ...base, aiMode: "assist", pausedUntil: "2026-01-15T13:00:00Z" }, NOW)).toMatchObject({ kind: "assist", tone: "blue" });
  });
  it("paused only while in the future", () => {
    const p = computeAiStatus({ ...base, pausedUntil: "2026-01-15T12:00:01.000Z" }, NOW);
    expect(p).toMatchObject({ kind: "paused", tone: "amber", canResume: true });
    expect(p.label).toMatch(/^IA en pausa hasta \d{2}:\d{2} \(respondiste tú\)$/);
    expect(computeAiStatus({ ...base, pausedUntil: "2026-01-15T12:00:00.000Z" }, NOW).kind).toBe("active");
    expect(computeAiStatus({ ...base, pausedUntil: "2026-01-15T11:59:59.000Z" }, NOW).kind).toBe("active");
  });
  it("active is green and has no conditions hint", () => {
    const s = computeAiStatus(base, NOW);
    expect(s).toMatchObject({ kind: "active", tone: "green", label: "IA activa: responde sola" });
    expect(s.reason).not.toContain("Para que responda sola");
  });
  it("non-active states include the conditions hint", () => {
    expect(computeAiStatus({ ...base, aiMode: "off" }, NOW).reason).toContain("Para que responda sola: modo automático, sin persona asignada, chat abierto y sin pausa");
  });
});

describe("isPausedAt / listAiTone", () => {
  it("handles null and invalid dates", () => {
    expect(isPausedAt(null, NOW)).toBe(false);
    expect(isPausedAt("nope", NOW)).toBe(false);
  });
  it("list tone ignores pause", () => {
    expect(listAiTone({ aiMode: "auto", status: "open", assigneeName: null }).tone).toBe("green");
  });
});
