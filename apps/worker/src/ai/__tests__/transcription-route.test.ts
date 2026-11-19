import type { LlmConnection } from "@crmwsp/db";
import { describe, expect, it, vi } from "vitest";
import { AUDIO_NOT_TRANSCRIBED, transcribeAttachment, voiceNoteText } from "../transcribe.js";
import { transcriptionRoute } from "../transcription-route.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const att = { id: "a1", externalMediaId: "m1", mimeType: "audio/ogg", transcript: null };
const loadMedia = vi.fn().mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg" });

function conn(over: Partial<LlmConnection>): LlmConnection {
  return {
    id: "chat-1",
    tenantId: "t",
    purpose: "chat",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEncrypted: Buffer.from("ciphertext"),
    apiKeyHint: "abcd",
    modelCheap: "m",
    modelStrong: null,
    capabilities: { structuredOutput: true, transcription: false },
    lastTestedAt: new Date(),
    lastTestOk: true,
    isActive: true,
    monthlyBudgetMinor: null,
    budgetCurrency: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const openRouterChat = conn({});
const dedicated = conn({
  id: "tr-1",
  purpose: "transcription",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  modelCheap: "gpt-4o-mini-transcribe",
  capabilities: { transcription: true },
});

function stub(text: string) {
  return { transcribe: vi.fn().mockResolvedValue({ text, durationSeconds: 3 }) };
}

describe("transcriptionRoute (ADR 0024)", () => {
  it("uses the dedicated transcription connection when present", async () => {
    const chatProvider = stub("from chat");
    const dedicatedProvider = stub("hola");
    const build = vi.fn().mockReturnValue(dedicatedProvider);
    const route = transcriptionRoute(openRouterChat, dedicated, chatProvider, build, logger);
    expect(route).toMatchObject({ source: "dedicated", model: "gpt-4o-mini-transcribe", connectionId: "tr-1" });
    expect(build).toHaveBeenCalledWith(dedicated);
    const out = await transcribeAttachment(att, { tenantId: "t", conversationId: "c", provider: route.provider, supported: true, model: route.model, loadMedia, logger });
    expect(voiceNoteText(out)).toBe("[voice note] hola");
    expect(chatProvider.transcribe).not.toHaveBeenCalled();
  });

  it("falls back to the chat connection when it can transcribe", () => {
    const chat = conn({ provider: "openai", capabilities: { transcription: true } });
    const chatProvider = stub("x");
    const build = vi.fn();
    const route = transcriptionRoute(chat, undefined, chatProvider, build, logger);
    expect(route).toMatchObject({ source: "chat", model: "whisper-1", connectionId: "chat-1" });
    expect(route.provider).toBe(chatProvider);
    expect(build).not.toHaveBeenCalled();
    // An untested dedicated connection is ignored too.
    expect(transcriptionRoute(chat, { ...dedicated, lastTestOk: null }, chatProvider, build, logger).source).toBe("chat");
  });

  it("is none for OpenRouter without a dedicated connection: the turn sees the marker", async () => {
    const route = transcriptionRoute(openRouterChat, undefined, stub("x"), vi.fn(), logger);
    expect(route.source).toBe("none");
    const out = await transcribeAttachment(att, { tenantId: "t", conversationId: "c", provider: route.provider, supported: false, model: route.model, loadMedia, logger });
    expect(voiceNoteText(out)).toBe(AUDIO_NOT_TRANSCRIBED);
  });

  it("falls back to chat when the dedicated key cannot be decrypted, without logging secrets", () => {
    const warn = vi.fn();
    const build = vi.fn(() => {
      throw new Error("sk-secret-should-not-leak");
    });
    const route = transcriptionRoute(openRouterChat, dedicated, stub("x"), build, { ...logger, warn });
    expect(route.source).toBe("none");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-secret");
  });
});
