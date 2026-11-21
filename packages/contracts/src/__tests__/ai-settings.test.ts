import { describe, expect, it } from "vitest";
import * as c from "../ai-settings.js";
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

describe("transcription connection (ADR 0024)", () => {

  it("defaults to OpenAI and whisper-1 and requires baseUrl for custom", () => {
    const parsed = c.saveAiTranscriptionConnectionRequestSchema.parse({ apiKey: "sk-test-12345678" });
    expect(parsed.provider).toBe("openai");
    expect(parsed.model).toBe("whisper-1");
    expect(c.saveAiTranscriptionConnectionRequestSchema.safeParse({ provider: "custom", apiKey: "sk-test-12345678" }).success).toBe(false);
    expect(c.saveAiTranscriptionConnectionRequestSchema.safeParse({ apiKey: "short" }).success).toBe(false);
  });

  it("status response never carries the key and accepts a null connection", () => {
    const status = c.aiTranscriptionStatusSchema.parse({
      connection: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKeyHint: "…abcd",
        model: "whisper-1",
        lastTestedAt: null,
        lastTestOk: null,
        apiKey: "sk-should-be-stripped",
      },
      source: "dedicated",
    });
    expect(status.connection?.purpose).toBe("transcription");
    expect(JSON.stringify(status)).not.toContain("sk-should-be-stripped");
    expect(c.aiTranscriptionStatusSchema.parse({ connection: null, source: "none" }).connection).toBeNull();
    expect(c.aiTranscriptionStatusSchema.safeParse({ connection: null, source: "other" }).success).toBe(false);
  });

  it("chat connection responses default purpose to chat", () => {
    const conn = c.aiConnectionSchema.parse({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyHint: null,
      modelCheap: "m",
      modelStrong: "m",
      capabilities: { structuredOutput: true, embeddings: false, transcription: false },
      lastTestedAt: null,
      lastTestOk: true,
      monthlyBudgetMinor: null,
      budgetCurrency: null,
    });
    expect(conn.purpose).toBe("chat");
  });
});
