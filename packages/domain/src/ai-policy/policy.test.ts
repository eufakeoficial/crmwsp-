import { describe, expect, it } from "vitest";
import { aiTurnOutputSchema } from "@crmwsp/contracts";
import type { AiAction, AiTurnOutput } from "@crmwsp/contracts";
import { evaluateAction, evaluateTurn } from "./policy.js";
import type { AiPolicyContext } from "./policy.js";

const ctx = (over: Partial<AiPolicyContext> = {}): AiPolicyContext => ({
  validChunkIds: new Set(["c1", "c2"]),
  confidenceThreshold: 0.7,
  approvalThresholdMinor: 100_000,
  policies: {},
  now: new Date("2026-10-20T12:00:00Z"),
  ...over,
});
const out = (over: Partial<AiTurnOutput> = {}): AiTurnOutput => ({
  actions: [],
  confidence: 0.9,
  needsHuman: false,
  reason: "r",
  ...over,
});
const claim = (kind: "price" | "stock" | "lead_time" | "policy" | "other", ids: string[]) => ({
  kind,
  text: "t",
  citations: ids.map((chunkId) => ({ chunkId })),
});
const decide = (a: unknown, c = ctx()) => evaluateAction(a, c).decision;
const hasHandoff = (r: ReturnType<typeof evaluateTurn>) =>
  r.actions.some((a) => (a.action as AiAction).type === "handoff" && a.decision === "auto");

describe("reply rules", () => {
  it("allows a conversational reply without claims", () => {
    expect(evaluateTurn(out({ reply: { text: "Hola", claims: [] } }), ctx()).reply.allowed).toBe(true);
  });
  it("allows a cited price", () => {
    const r = evaluateTurn(out({ reply: { text: "$10", claims: [claim("price", ["c1"])] } }), ctx());
    expect(r.reply.allowed).toBe(true);
  });
  it.each(["price", "stock", "lead_time", "policy"] as const)("blocks invented %s without citation", (k) => {
    const r = evaluateTurn(out({ reply: { text: "x", claims: [claim(k, [])] } }), ctx());
    expect(r.reply.allowed).toBe(false);
    expect(hasHandoff(r)).toBe(true);
  });
  it("blocks citation to a chunk of another tenant", () => {
    const r = evaluateTurn(out({ reply: { text: "x", claims: [claim("price", ["other-tenant"])] } }), ctx());
    expect(r.reply.allowed).toBe(false);
    expect(hasHandoff(r)).toBe(true);
  });
  it("blocks when one of several citations is invalid", () => {
    const r = evaluateTurn(out({ reply: { text: "x", claims: [claim("stock", ["c1", "evil"])] } }), ctx());
    expect(r.reply.allowed).toBe(false);
  });
  it("blocks uncited price even in assist mode", () => {
    const r = evaluateTurn(out({ reply: { text: "x", claims: [claim("price", [])] } }), ctx({ mode: "assist" }));
    expect(r.reply.allowed).toBe(false);
  });
  it("allows 'other' claims without citations", () => {
    const r = evaluateTurn(out({ reply: { text: "x", claims: [claim("other", [])] } }), ctx());
    expect(r.reply.allowed).toBe(true);
  });
  it("blocks low confidence in auto mode", () => {
    const r = evaluateTurn(out({ confidence: 0.5, reply: { text: "x", claims: [] } }), ctx());
    expect(r.reply.allowed).toBe(false);
    expect(hasHandoff(r)).toBe(true);
  });
  it("drafts low confidence in assist mode", () => {
    const r = evaluateTurn(out({ confidence: 0.5, reply: { text: "x", claims: [] } }), ctx({ mode: "assist" }));
    expect(r.reply).toMatchObject({ allowed: true, draft: true });
  });
  it.each([1.5, -0.2, Number.NaN])("treats out-of-range confidence %s as low", (c) => {
    const r = evaluateTurn(out({ confidence: c, reply: { text: "x", claims: [] } }), ctx());
    expect(r.reply.allowed).toBe(false);
  });
  it("blocks auto reply when the model requests a human", () => {
    const r = evaluateTurn(out({ needsHuman: true, reply: { text: "x", claims: [] } }), ctx());
    expect(r.reply.allowed).toBe(false);
  });
  it("does not duplicate an existing handoff", () => {
    const r = evaluateTurn(
      out({ reply: { text: "x", claims: [claim("price", [])] }, actions: [{ type: "handoff", reason: "h" }] }),
      ctx(),
    );
    expect(r.actions.filter((a) => (a.action as AiAction).type === "handoff")).toHaveLength(1);
  });
  it("reports no reply when absent", () => {
    expect(evaluateTurn(out(), ctx()).reply.allowed).toBe(false);
  });
});

describe("action rules", () => {
  const field = (confidence: number) => ({
    type: "update_contact_field",
    field: "email",
    value: "a@b.c",
    confidence,
    sourceMessageId: "m1",
  });
  it("auto-applies high-confidence field", () => expect(decide(field(0.9))).toBe("auto"));
  it("requires approval for low-confidence field", () => expect(decide(field(0.3))).toBe("approve"));
  it("threshold is inclusive", () => expect(decide(field(0.7))).toBe("auto"));
  it("auto-creates tasks", () => expect(decide({ type: "create_task", title: "Llamar" })).toBe("auto"));
  it("tasks due in the past need approval", () =>
    expect(decide({ type: "create_task", title: "x", dueAt: "2020-01-01T00:00:00Z" })).toBe("approve"));
  it("moves forward in initial stages automatically", () =>
    expect(decide({ type: "move_stage", stage: "qualified" }, ctx({ currentStage: "contacted" }))).toBe("auto"));
  it("moving backwards needs approval", () =>
    expect(decide({ type: "move_stage", stage: "new" }, ctx({ currentStage: "qualified" }))).toBe("approve"));
  it("moving to won needs approval", () =>
    expect(decide({ type: "move_stage", stage: "won" }, ctx({ currentStage: "negotiation" }))).toBe("approve"));
  it("unknown stage needs approval", () => expect(decide({ type: "move_stage", stage: "vip" })).toBe("approve"));
  it("quote with valid chunks needs approval", () =>
    expect(decide({ type: "create_quote_draft", items: [{ chunkId: "c1", quantity: 2 }] })).toBe("approve"));
  it("quote with foreign chunk is denied", () =>
    expect(decide({ type: "create_quote_draft", items: [{ chunkId: "c1", quantity: 1 }, { chunkId: "x", quantity: 1 }] })).toBe("deny"));
  it("10% discount needs approval", () => expect(decide({ type: "apply_discount", percent: 10 })).toBe("approve"));
  it("50% discount needs approval", () => expect(decide({ type: "apply_discount", percent: 50 })).toBe("approve"));
  it("90% discount is denied", () => expect(decide({ type: "apply_discount", percent: 90 })).toBe("deny"));
  it("negative discount is denied", () => expect(decide({ type: "apply_discount", percent: -5 })).toBe("deny"));
  it("templates need approval", () => expect(decide({ type: "send_template", templateName: "promo" })).toBe("approve"));
  it("handoff is auto", () => expect(decide({ type: "handoff", reason: "x" })).toBe("auto"));
  it("unknown action is denied", () => expect(decide({ type: "wire_money", amount: 1 })).toBe("deny"));
  it("action with extra fields is denied", () =>
    expect(decide({ type: "create_task", title: "x", assignee: "admin" })).toBe("deny"));
  it("non-object action is denied", () => expect(decide("drop table")).toBe("deny"));
});

describe("tenant policies", () => {
  it("can tighten create_task to approve", () =>
    expect(decide({ type: "create_task", title: "x" }, ctx({ policies: { actionOverrides: { create_task: "approve" } } }))).toBe("approve"));
  it("cannot relax create_quote_draft to auto", () =>
    expect(
      decide(
        { type: "create_quote_draft", items: [{ chunkId: "c1", quantity: 1 }] },
        ctx({ policies: { actionOverrides: { create_quote_draft: "auto" } } }),
      ),
    ).toBe("approve"));
  it("cannot relax a denied discount", () =>
    expect(decide({ type: "apply_discount", percent: 90 }, ctx({ policies: { actionOverrides: { apply_discount: "auto" } } }))).toBe("deny"));
  it("can deny templates outright", () =>
    expect(decide({ type: "send_template", templateName: "p" }, ctx({ policies: { actionOverrides: { send_template: "deny" } } }))).toBe("deny"));
  it("requireApprovalForAll turns auto into approve", () =>
    expect(decide({ type: "create_task", title: "x" }, ctx({ policies: { requireApprovalForAll: true } }))).toBe("approve"));
  it("cannot block handoff", () =>
    expect(decide({ type: "handoff", reason: "x" }, ctx({ policies: { actionOverrides: { handoff: "deny" } } }))).toBe("auto"));
});

describe("model JSON validation (strict)", () => {
  it("rejects extra fields before reaching the engine", () => {
    expect(aiTurnOutputSchema.safeParse({ ...out(), admin: true }).success).toBe(false);
  });
  it("rejects confidence out of range", () => {
    expect(aiTurnOutputSchema.safeParse(out({ confidence: 2 })).success).toBe(false);
  });
  it("denies extra/unknown actions smuggled past typing", () => {
    const r = evaluateTurn(out({ actions: [{ type: "export_db" } as unknown as AiAction] }), ctx());
    expect(r.actions[0]?.decision).toBe("deny");
  });
});

describe("factual heuristics (bypass attempts)", () => {
  const other = (text: string, ids: string[] = []) => ({ kind: "other" as const, text, citations: ids.map((chunkId) => ({ chunkId })) });
  it.each(["cuesta 780 €", "sale $50.000", "USD 12", "20% de descuento", "quedan 3 unidades en stock", "entrega en 48 h", "lo tenés en 5 días hábiles"])(
    "blocks uncited 'other' claim: %s",
    (text) => {
      const r = evaluateTurn(out({ reply: { text: "Mirá", claims: [other(text)] } }), ctx());
      expect(r.reply.allowed).toBe(false);
      expect(hasHandoff(r)).toBe(true);
    },
  );
  it("allows a factual-looking 'other' claim when validly cited", () => {
    expect(evaluateTurn(out({ reply: { text: "Cuesta 780 €", claims: [other("cuesta 780 €", ["c1"])] } }), ctx()).reply.allowed).toBe(true);
  });
  it.each(["El látex cuesta 780 €", "Te hago un 30% off", "Hay stock disponible", "Te lo entregamos en 2 semanas"])(
    "blocks reply text with facts and no claims: %s",
    (text) => {
      const r = evaluateTurn(out({ reply: { text, claims: [] } }), ctx());
      expect(r.reply.allowed).toBe(false);
      expect(hasHandoff(r)).toBe(true);
    },
  );
  it("blocks factual reply text whose only claims are uncited 'other'", () => {
    expect(evaluateTurn(out({ reply: { text: "Son $500", claims: [other("saludo")] } }), ctx()).reply.allowed).toBe(false);
  });
  it("still allows plain conversation", () => {
    expect(evaluateTurn(out({ reply: { text: "¡Hola Juan! ¿En qué te ayudo?", claims: [] } }), ctx()).reply.allowed).toBe(true);
  });
});

describe("hardening rules (gate F2-B)", () => {
  it.each([50.01, 51, 100, -1, Number.NaN])("denies discount %s", (percent) => {
    expect(decide({ type: "apply_discount", percent })).toBe("deny");
  });
  it("tenant policy cannot loosen a decision", () => {
    expect(decide({ type: "apply_discount", percent: 10 }, ctx({ policies: { actionOverrides: { apply_discount: "auto" } } }))).toBe("approve");
    expect(decide({ type: "apply_discount", percent: 90 }, ctx({ policies: { actionOverrides: { apply_discount: "auto" } } }))).toBe("deny");
  });
  it.each([{ type: "transfer_money", amount: 1 }, { type: "move_stage" }, { type: "handoff", reason: "x", extra: 1 }, null, "handoff"])(
    "denies unknown or malformed action %#",
    (a) => expect(decide(a)).toBe("deny"),
  );
  it("quotes go to approve whatever approvalThresholdMinor says", () => {
    expect(decide({ type: "create_quote_draft", items: [{ chunkId: "c1", quantity: 1 }] }, ctx({ approvalThresholdMinor: Number.MAX_SAFE_INTEGER }))).toBe("approve");
  });
});
