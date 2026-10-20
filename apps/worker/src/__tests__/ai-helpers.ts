import { randomBytes, randomUUID } from "node:crypto";
import { createCipherBox, type CipherBox } from "@crmwsp/crypto";
import {
  contacts,
  conversations,
  knowledgeChunks,
  knowledgeSources,
  llmConnections,
  messages,
  type AiMode,
  type DbHandle,
  type LlmCapabilities,
} from "@crmwsp/db";
import { vi } from "vitest";
import { LLM_API_KEY_PURPOSE, type AiDeps } from "../ai/index.js";
import type { EventPublisher } from "../processors.js";
import { seedTenants, type SeedTenant } from "./helpers.js";

export const LLM_KEY = `sk-test-${randomUUID()}`;
export const BASE_URL = "https://llm.example.test/v1";
export const publicLookup = async () => [{ address: "93.184.216.34" }];
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeCipher(): CipherBox {
  // Test-only master key.
  return createCipherBox({ keys: new Map([[1, randomBytes(32)]]), activeKeyId: 1 });
}

export interface RecordedCall {
  path: string;
  body: { model?: string; input?: string[]; messages?: Array<{ role: string; content: string }> };
  authorization: string | null;
}

export type ChatReply = Response | Record<string, unknown> | string;

export interface MockLlm {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
  chatCalls(): RecordedCall[];
  embedCalls(): RecordedCall[];
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Content of a chat completion carrying `out` (the AI turn in strict-mode shape). */
export function chatResponse(content: string, usage = { prompt_tokens: 100, completion_tokens: 50 }): Response {
  return json({ model: "gpt-5-mini-2025-08-07", choices: [{ message: { content }, finish_reason: "stop" }], usage });
}

export interface TurnOut {
  reply?: { text: string; claims: Array<{ kind: string; text: string; citations: Array<{ chunkId: string }> }> } | null;
  actions?: Array<Record<string, unknown>>;
  confidence?: number;
  needsHuman?: boolean;
  reason?: string;
}

export function turnJson(o: TurnOut = {}): string {
  return JSON.stringify({
    reply: o.reply ?? null,
    actions: o.actions ?? [],
    confidence: o.confidence ?? 0.9,
    needsHuman: o.needsHuman ?? false,
    reason: o.reason ?? "ok",
  });
}

/** Mocked OpenAI-compatible API. `chat` receives the call and its 0-based index among chat calls. */
export function mockLlm(chat: (call: RecordedCall, n: number) => ChatReply | Promise<ChatReply>): MockLlm {
  const calls: RecordedCall[] = [];
  let chatN = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace(/^\/v1/, "");
    const call: RecordedCall = {
      path,
      body: JSON.parse(String(init?.body ?? "{}")),
      authorization: (init?.headers as Record<string, string> | undefined)?.["authorization"] ?? null,
    };
    calls.push(call);
    if (path === "/embeddings") {
      const input = call.body.input ?? [];
      return json({ data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })), usage: { prompt_tokens: input.length * 5 } });
    }
    if (path === "/chat/completions") {
      const r = await chat(call, chatN++);
      if (r instanceof Response) return r;
      return chatResponse(typeof r === "string" ? r : JSON.stringify(r));
    }
    return json({ error: "not found" }, 404);
  });
  return {
    fetch: fn as unknown as typeof globalThis.fetch,
    calls,
    chatCalls: () => calls.filter((c) => c.path === "/chat/completions"),
    embedCalls: () => calls.filter((c) => c.path === "/embeddings"),
  };
}

export interface AiTenant extends SeedTenant {
  connectionRowId: string;
}

/** Fresh tenant with an active, tested LLM connection (encrypted key, embeddings capability). */
export async function seedAiTenant(
  migrator: DbHandle,
  cipher: CipherBox,
  opts: { capabilities?: LlmCapabilities; budgetMinor?: bigint; connection?: boolean } = {},
): Promise<AiTenant> {
  const [t] = (await seedTenants(migrator, 1)) as [SeedTenant];
  let connectionRowId = "";
  if (opts.connection !== false) {
    const [row] = await migrator.db
      .insert(llmConnections)
      .values({
        tenantId: t.tenantId,
        provider: "openai",
        baseUrl: BASE_URL,
        apiKeyEncrypted: cipher.encrypt(LLM_KEY, { tenantId: t.tenantId, purpose: LLM_API_KEY_PURPOSE }),
        apiKeyHint: "1234",
        modelCheap: "gpt-5-mini",
        modelStrong: "gpt-5",
        capabilities: opts.capabilities ?? { structuredOutput: true, embeddings: true },
        isActive: true,
        lastTestOk: true,
        lastTestedAt: new Date(),
        ...(opts.budgetMinor !== undefined ? { monthlyBudgetMinor: opts.budgetMinor, budgetCurrency: "USD" } : {}),
      })
      .returning({ id: llmConnections.id });
    connectionRowId = row!.id;
  }
  return { ...t, connectionRowId };
}

export interface Convo {
  conversationId: string;
  contactId: string;
  /** Adds an inbound customer message and returns its id. */
  inbound(text: string): Promise<string>;
}

export async function seedConversation(migrator: DbHandle, t: SeedTenant, aiMode: AiMode, firstText?: string): Promise<Convo & { firstMessageId?: string }> {
  const [c] = await migrator.db
    .insert(contacts)
    .values({ tenantId: t.tenantId, phoneE164: `+34${Math.floor(Math.random() * 1e9)}`, name: "Ana" })
    .returning({ id: contacts.id });
  const [conv] = await migrator.db
    .insert(conversations)
    .values({ tenantId: t.tenantId, contactId: c!.id, channelConnectionId: t.connectionId, aiMode, lastInboundAt: new Date() })
    .returning({ id: conversations.id });
  const inbound = async (text: string): Promise<string> => {
    const [m] = await migrator.db
      .insert(messages)
      .values({
        tenantId: t.tenantId,
        conversationId: conv!.id,
        direction: "inbound",
        type: "text",
        body: text,
        externalId: `ext-${randomUUID()}`,
        status: "received",
        author: "contact",
      })
      .returning({ id: messages.id });
    return m!.id;
  };
  const out: Convo & { firstMessageId?: string } = { conversationId: conv!.id, contactId: c!.id, inbound };
  if (firstText !== undefined) out.firstMessageId = await inbound(firstText);
  return out;
}

/** Source + chunks (no embeddings yet). */
export async function seedKnowledge(migrator: DbHandle, t: SeedTenant, contents: string[]): Promise<{ sourceId: string; chunkIds: string[] }> {
  const [s] = await migrator.db
    .insert(knowledgeSources)
    .values({ tenantId: t.tenantId, kind: "faq", title: "Tarifas", status: "ready" })
    .returning({ id: knowledgeSources.id });
  const chunkIds: string[] = [];
  const rows = await migrator.db
    .insert(knowledgeChunks)
    .values(contents.map((content, ordinal) => ({ tenantId: t.tenantId, sourceId: s!.id, sourceVersion: 1, ordinal, content })))
    .returning({ id: knowledgeChunks.id, ordinal: knowledgeChunks.ordinal });
  for (const r of rows.sort((a, b) => a.ordinal - b.ordinal)) chunkIds.push(r.id);
  return { sourceId: s!.id, chunkIds };
}

export interface Captured {
  channel: string;
  event: { type: string; conversationId?: string; actionId?: string; messageId?: string; month?: string };
}

export function capturePublisher(): { publisher: EventPublisher; events: Captured[]; types(): string[] } {
  const events: Captured[] = [];
  return {
    events,
    types: () => events.map((e) => e.event.type),
    publisher: {
      publish: async (channel, message) => {
        events.push({ channel, event: JSON.parse(message) });
        return 1;
      },
    },
  };
}

export type BaseDeps = Pick<AiDeps, "db" | "cipher" | "publisher" | "outboundQueue">;
