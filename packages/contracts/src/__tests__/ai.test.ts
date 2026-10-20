import { describe, expect, it } from "vitest";
import { aiActionSchema, aiTurnOutputSchema } from "../ai.js";

const base = { actions: [], confidence: 0.9, needsHuman: false, reason: "ok" };

describe("aiTurnOutputSchema", () => {
  it("accepts a minimal valid output", () => {
    expect(aiTurnOutputSchema.safeParse(base).success).toBe(true);
  });
  it("rejects extra top-level fields", () => {
    expect(aiTurnOutputSchema.safeParse({ ...base, sql: "drop" }).success).toBe(false);
  });
  it("rejects confidence out of range", () => {
    expect(aiTurnOutputSchema.safeParse({ ...base, confidence: 1.2 }).success).toBe(false);
    expect(aiTurnOutputSchema.safeParse({ ...base, confidence: -0.1 }).success).toBe(false);
  });
  it("rejects unknown action types and extra action fields", () => {
    expect(aiActionSchema.safeParse({ type: "delete_contact" }).success).toBe(false);
    expect(aiActionSchema.safeParse({ type: "move_stage", stage: "won", force: true }).success).toBe(false);
  });
  it("rejects extra fields in claims", () => {
    const r = aiTurnOutputSchema.safeParse({
      ...base,
      reply: { text: "hi", claims: [{ kind: "price", text: "x", citations: [], trustMe: true }] },
    });
    expect(r.success).toBe(false);
  });
});
