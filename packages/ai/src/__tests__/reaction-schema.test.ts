import { describe, expect, it } from "vitest";
import { aiTurnJsonSchema, aiTurnResponseFormat } from "../ai-turn-schema.js";
import { buildAiTurnMessages } from "../prompts/index.js";

const base = { reply: null, actions: [], confidence: 0.9, needsHuman: false, reason: "r" };

describe("reaction in the AI turn output", () => {
  it("is part of the strict schema", () => {
    expect(Object.keys(aiTurnJsonSchema.properties as Record<string, unknown>)).toContain("reaction");
  });
  it("keeps an allowed emoji (also without the variation selector)", () => {
    expect(aiTurnResponseFormat.schema.parse({ ...base, reaction: { emoji: "🙏" } }).reaction).toEqual({ emoji: "🙏" });
    expect(aiTurnResponseFormat.schema.parse({ ...base, reaction: { emoji: "❤" } }).reaction).toEqual({ emoji: "❤️" });
  });
  it("drops null, unknown emoji and malformed values instead of failing the turn", () => {
    expect(aiTurnResponseFormat.schema.parse({ ...base, reaction: null }).reaction).toBeUndefined();
    expect(aiTurnResponseFormat.schema.parse({ ...base, reaction: { emoji: "💀" } }).reaction).toBeUndefined();
    expect(aiTurnResponseFormat.schema.parse({ ...base, reaction: "👍" }).reaction).toBeUndefined();
  });
  it("the prompt tells the model to react sparingly and never on complaints", () => {
    const [system] = buildAiTurnMessages({
      systemPrompt: "x",
      tenantName: "T",
      conversation: [],
      contact: {},
      retrievedChunks: [],
      nowIso: "2026-10-21T00:00:00Z",
    });
    expect(system?.content).toContain("Never react to a complaint");
    expect(system?.content).toContain("never use a reaction instead of answering");
  });
});
