import { aiScenarioInputSchema, type AiTurnOutput } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SCENARIOS, checkExpectations, dryRunTurn, toTenantPolicies, type DryRunInput } from "./index.js";

const chunks = new Map([["c1", { sourceTitle: "Tarifas", content: "Servicio básico: 50 EUR" }]]);
const base = (output: Partial<AiTurnOutput>, extra: Partial<DryRunInput> = {}): DryRunInput => ({
  output: { actions: [], confidence: 0.9, needsHuman: false, reason: "r", ...output },
  chunks,
  contextIds: new Set(["m1"]),
  confidenceThreshold: 0.75,
  approvalThresholdMinor: 0,
  policies: {},
  now: new Date("2026-10-20T10:00:00Z"),
  ...extra,
});

describe("dryRunTurn", () => {
  it("cited price reply would be sent and passes must_cite_price", () => {
    const r = dryRunTurn(base({ reply: { text: "Cuesta 50 EUR", claims: [{ kind: "price", text: "50 EUR", citations: [{ chunkId: "c1" }] }] } }));
    expect(r.reply).toMatchObject({ outcome: "send" });
    expect(r.reply!.claims[0]!.citations[0]).toMatchObject({ valid: true, sourceTitle: "Tarifas" });
    expect(r.handoff).toBe(false);
    expect(checkExpectations(r, ["must_reply", "must_cite_price", "must_not_handoff"]).every((c) => c.passed)).toBe(true);
  });

  it("uncited price is blocked and handed off by the policy engine", () => {
    const r = dryRunTurn(base({ reply: { text: "Cuesta 1 EUR", claims: [{ kind: "price", text: "1 EUR", citations: [{ chunkId: "nope" }] }] } }));
    expect(r.reply!.outcome).toBe("blocked");
    expect(r.reply!.claims[0]!.citations[0]!.valid).toBe(false);
    expect(r.handoff).toBe(true);
    expect(r.actions.find((a) => a.type === "handoff")).toMatchObject({ verdict: "auto", addedByPolicy: true });
    const checks = checkExpectations(r, ["must_handoff", "must_cite_price"]);
    expect(checks.map((c) => c.passed)).toEqual([true, false]);
  });

  it("maps decisions to verdicts: discount needs approval, 70% blocked, quote on unknown chunk blocked", () => {
    const r = dryRunTurn(
      base({
        actions: [
          { type: "apply_discount", percent: 10 },
          { type: "apply_discount", percent: 70 },
          { type: "create_quote_draft", items: [{ chunkId: "zz", quantity: 1 }] },
          { type: "create_task", title: "llamar" },
        ],
      }),
    );
    expect(r.actions.map((a) => a.verdict)).toEqual(["needs_approval", "blocked", "blocked", "auto"]);
    expect(r.actions[0]!.payload).toEqual({ percent: 10 });
    const checks = checkExpectations(r, ["must_not_discount", "must_not_quote", "must_need_approval"]);
    expect(checks.map((c) => c.passed)).toEqual([false, true, true]);
  });

  it("update_contact_field from an unseen message needs approval", () => {
    const r = dryRunTurn(
      base({ actions: [{ type: "update_contact_field", field: "email", value: "a@b.c", confidence: 0.99, sourceMessageId: "other" }] }),
    );
    expect(r.actions[0]).toMatchObject({ verdict: "needs_approval" });
    expect(r.actions[0]!.reason).toContain("source message not in context");
  });

  it("tenant overrides only make decisions stricter", () => {
    const r = dryRunTurn(base({ actions: [{ type: "create_task", title: "x" }] }, { policies: toTenantPolicies({ create_task: "deny", bogus: "auto" }) }));
    expect(r.actions[0]!.verdict).toBe("blocked");
  });

  it("low confidence in auto mode blocks the reply and hands off", () => {
    const r = dryRunTurn(base({ confidence: 0.2, reply: { text: "hola", claims: [] } }));
    expect(r.reply!.outcome).toBe("blocked");
    expect(r.handoff).toBe(true);
  });
});

describe("DEFAULT_AI_SCENARIOS", () => {
  it("ships 5 valid Spanish scenarios", () => {
    expect(DEFAULT_AI_SCENARIOS).toHaveLength(5);
    for (const s of DEFAULT_AI_SCENARIOS) expect(aiScenarioInputSchema.safeParse(s).success).toBe(true);
  });
});
