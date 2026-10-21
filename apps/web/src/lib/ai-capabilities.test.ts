import { describe, expect, it } from "vitest";
import { AI_CHILDREN, SETTINGS_SECTIONS } from "../components/app/nav-items";
import { AI_CAPABILITIES, computeCapabilityStatus, type AiCapabilityData } from "./ai-capabilities";

const none: AiCapabilityData = { connection: undefined, sources: undefined, voice: undefined, owner: undefined, agent: undefined, playbook: undefined };

describe("AI capabilities overview", () => {
  it("has unique keys and only links to routes that exist in the app", () => {
    expect(new Set(AI_CAPABILITIES.map((c) => c.key)).size).toBe(AI_CAPABILITIES.length);
    const known = new Set([
      ...AI_CHILDREN.map((i) => i.href),
      ...SETTINGS_SECTIONS.map((i) => i.href),
      "/app/settings/ai/simulator",
      "/app/inbox",
    ]);
    for (const c of AI_CAPABILITIES) expect(known.has(c.href.split("#")[0]!), `${c.key} -> ${c.href}`).toBe(true);
  });
  it("covers the playbook, runs, attention queue, voice, budget, simulator and owner mode", () => {
    const keys = AI_CAPABILITIES.map((c) => c.key);
    for (const k of ["mode", "knowledge", "handoff", "runs", "attention", "playbook", "simulator", "budget", "voice", "improve", "orders", "owner"]) {
      expect(keys).toContain(k);
    }
  });
  it("is inactive without data and shows no chip for history views", () => {
    const s = computeCapabilityStatus(none);
    expect(s.playbook).toBe(false);
    expect(s.mode).toBe(false);
    expect(s.runs).toBeNull();
    expect(s.attention).toBeNull();
  });
  it("reads mode, playbook and budget from the loaded configuration", () => {
    const s = computeCapabilityStatus({
      ...none,
      connection: { monthlyBudgetMinor: 5000 } as never,
      agent: { aiModeDefault: "auto" } as never,
      playbook: { enabled: true } as never,
    });
    expect(s).toMatchObject({ mode: true, playbook: true, budget: true, handoff: true });
    expect(computeCapabilityStatus({ ...none, connection: { monthlyBudgetMinor: null } as never, agent: { aiModeDefault: "off" } as never }).mode).toBe(false);
    expect(computeCapabilityStatus({ ...none, connection: { monthlyBudgetMinor: null } as never }).budget).toBe(false);
  });
});
