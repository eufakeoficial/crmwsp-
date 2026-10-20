import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_BASE_URLS,
  agentConfigSchema,
  aiActionItemSchema,
  aiConnectionResponseSchema,
  aiUsageQuerySchema,
  createTextKnowledgeSourceRequestSchema,
  knowledgeSourceSchema,
  saveAiConnectionRequestSchema,
} from "../ai-settings.js";

const save = { provider: "openai", modelCheap: "gpt-5-mini", modelStrong: "gpt-5" } as const;

describe("saveAiConnectionRequestSchema", () => {
  it("accepts a minimal request without key (keeps the stored one)", () => {
    expect(saveAiConnectionRequestSchema.safeParse(save).success).toBe(true);
  });
  it("requires baseUrl for custom providers only", () => {
    expect(saveAiConnectionRequestSchema.safeParse({ ...save, provider: "custom" }).success).toBe(false);
    expect(
      saveAiConnectionRequestSchema.safeParse({ ...save, provider: "custom", baseUrl: "https://llm.example.com/v1" }).success,
    ).toBe(true);
  });
  it("requires a currency with a budget", () => {
    expect(saveAiConnectionRequestSchema.safeParse({ ...save, monthlyBudgetMinor: 2000 }).success).toBe(false);
    expect(saveAiConnectionRequestSchema.safeParse({ ...save, monthlyBudgetMinor: 2000, budgetCurrency: "EUR" }).success).toBe(true);
    expect(saveAiConnectionRequestSchema.safeParse({ ...save, monthlyBudgetMinor: -1, budgetCurrency: "EUR" }).success).toBe(false);
  });
  it("rejects unknown providers and short keys", () => {
    expect(saveAiConnectionRequestSchema.safeParse({ ...save, provider: "opencode" }).success).toBe(false);
    expect(saveAiConnectionRequestSchema.safeParse({ ...save, apiKey: "short" }).success).toBe(false);
  });
});

describe("response schemas", () => {
  it("accepts null for no connection", () => {
    expect(aiConnectionResponseSchema.parse(null)).toBeNull();
  });
  it("agent config allows a null approval threshold and bounds confidence", () => {
    const ok = { systemPrompt: "", aiModeDefault: "assist", confidenceThreshold: 0.7, approvalThresholdMinor: null };
    expect(agentConfigSchema.safeParse(ok).success).toBe(true);
    expect(agentConfigSchema.safeParse({ ...ok, confidenceThreshold: 1.5 }).success).toBe(false);
    expect(agentConfigSchema.safeParse({ ...ok, aiModeDefault: "manual" }).success).toBe(false);
  });
  it("knowledge source and action item shapes", () => {
    expect(
      knowledgeSourceSchema.safeParse({ id: "1", kind: "csv", title: "t", status: "ready", version: 1, chunkCount: 3, updatedAt: "x" })
        .success,
    ).toBe(true);
    expect(
      aiActionItemSchema.safeParse({
        id: "1",
        type: "apply_discount",
        status: "pending_approval",
        conversationId: null,
        contactName: null,
        payload: {},
        reason: null,
        citations: [{ chunkId: "c" }],
        createdAt: "x",
      }).success,
    ).toBe(true);
  });
});

describe("request helpers", () => {
  it("validates the month query", () => {
    expect(aiUsageQuerySchema.safeParse({ month: "2026-10" }).success).toBe(true);
    expect(aiUsageQuerySchema.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(aiUsageQuerySchema.safeParse({}).success).toBe(true);
  });
  it("accepts only faq/text as JSON sources", () => {
    expect(createTextKnowledgeSourceRequestSchema.safeParse({ kind: "faq", title: "FAQ", content: "P: a\nR: b" }).success).toBe(true);
    expect(createTextKnowledgeSourceRequestSchema.safeParse({ kind: "csv", title: "x", content: "y" }).success).toBe(false);
  });
  it("exposes the fixed provider URLs", () => {
    expect(AI_PROVIDER_BASE_URLS.openrouter).toBe("https://openrouter.ai/api/v1");
  });
});
