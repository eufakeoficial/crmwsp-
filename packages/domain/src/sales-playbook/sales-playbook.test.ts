import { describe, expect, it } from "vitest";
import { playbookConfigSchema } from "@crmwsp/contracts";
import {
  DEFAULT_PLAYBOOK,
  PLAYBOOK_PROMPT_CAPS,
  buildPlaybookContext,
  matchObjections,
  playbookConfigColumn,
  resolvePlaybook,
  sanitizeDetectedPlaybook,
} from "./index.js";

const on = { ...DEFAULT_PLAYBOOK, enabled: true };

describe("DEFAULT_PLAYBOOK", () => {
  it("satisfies the contract and ships the four standard objections", () => {
    expect(playbookConfigSchema.safeParse(DEFAULT_PLAYBOOK).success).toBe(true);
    expect(DEFAULT_PLAYBOOK.objections.map((o) => o.id)).toEqual(["es-caro", "lo-voy-a-pensar", "envios-plazos", "no-confio"]);
    expect(DEFAULT_PLAYBOOK.enabled).toBe(false);
  });
  it("keeps follow-ups inside the WhatsApp 24h window", () => {
    expect(playbookConfigSchema.safeParse({ ...DEFAULT_PLAYBOOK, followUp: { enabled: true, delayHours: 24, maxFollowUps: 1 } }).success).toBe(false);
  });
  it("rejects duplicate objection ids", () => {
    const o = DEFAULT_PLAYBOOK.objections[0]!;
    expect(playbookConfigSchema.safeParse({ ...DEFAULT_PLAYBOOK, objections: [o, o] }).success).toBe(false);
  });
});

describe("resolvePlaybook", () => {
  it("returns defaults (disabled) without a row", () => {
    expect(resolvePlaybook(undefined)).toEqual(DEFAULT_PLAYBOOK);
  });
  it("merges a partial stored config over the defaults and uses the enabled column", () => {
    const r = resolvePlaybook({ enabled: true, config: { closingStyle: "direct", stages: { closing: "Cierra ya." } } });
    expect(r.enabled).toBe(true);
    expect(r.closingStyle).toBe("direct");
    expect(r.stages.closing).toBe("Cierra ya.");
    expect(r.stages.discovery).toBe(DEFAULT_PLAYBOOK.stages.discovery);
  });
  it("falls back to disabled defaults when the stored config is invalid", () => {
    const r = resolvePlaybook({ enabled: true, config: { closingStyle: "aggressive" } });
    expect(r.enabled).toBe(false);
    expect(r.closingStyle).toBe("soft");
  });
  it("round-trips through the config column", () => {
    const col = playbookConfigColumn(on);
    expect(col).not.toHaveProperty("enabled");
    expect(resolvePlaybook({ enabled: true, config: col })).toEqual(on);
  });
});

describe("matchObjections", () => {
  it("matches by shared keywords ignoring accents and case", () => {
    expect(matchObjections(on, "Uff, me parece MUY CARO").map((o) => o.id)).toEqual(["es-caro"]);
    expect(matchObjections(on, "¿Hacen envíos a Cusco? ¿cuánto demora la entrega?").map((o) => o.id)).toEqual(["envios-plazos"]);
    expect(matchObjections(on, "Lo voy a pensar y te aviso").map((o) => o.id)).toEqual(["lo-voy-a-pensar"]);
    expect(matchObjections(on, "no confío, ¿es una estafa?").map((o) => o.id)).toEqual(["no-confio"]);
  });
  it("returns nothing for unrelated text and caps the result", () => {
    expect(matchObjections(on, "hola buenas tardes")).toEqual([]);
    expect(matchObjections(on, "")).toEqual([]);
    expect(matchObjections(on, "caro envíos pensar confío estafa", 2)).toHaveLength(2);
  });
});

describe("buildPlaybookContext", () => {
  it("is null when disabled", () => {
    expect(buildPlaybookContext(DEFAULT_PLAYBOOK, { previousStage: null, customerText: "caro" })).toBeNull();
  });
  it("starts in discovery and only carries the current stage and matching objections", () => {
    const ctx = buildPlaybookContext(on, { previousStage: null, customerText: "es caro" })!;
    expect(ctx.stage).toBe("discovery");
    expect(ctx.stageGuidance).toBe(DEFAULT_PLAYBOOK.stages.discovery);
    expect(ctx.objections.map((o) => o.id)).toEqual(["es-caro"]);
    expect(JSON.stringify(ctx)).not.toContain("no-confio");
  });
  it("keeps the previous stage and clips long guidance to the caps", () => {
    const long = { ...on, stages: { ...on.stages, closing: "x".repeat(500) } };
    const ctx = buildPlaybookContext(long, { previousStage: "closing", customerText: "ok" })!;
    expect(ctx.stage).toBe("closing");
    expect(ctx.stageGuidance.length).toBe(PLAYBOOK_PROMPT_CAPS.stage);
  });
});

describe("sanitizeDetectedPlaybook", () => {
  it("keeps valid stages and only offered objections", () => {
    expect(sanitizeDetectedPlaybook({ salesStage: "closing", objection: "es-caro" }, ["es-caro"])).toEqual({ salesStage: "closing", objection: "es-caro" });
    expect(sanitizeDetectedPlaybook({ salesStage: "hacking", objection: "other" }, ["es-caro"])).toEqual({});
    expect(sanitizeDetectedPlaybook({}, [])).toEqual({});
  });
});
