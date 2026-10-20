import { Inject, Injectable } from "@nestjs/common";
import {
  LlmProviderError,
  PROMPT_VERSION,
  aiTurnResponseFormat,
  buildAiTurnMessages,
  estimateCost,
  type ChatMessage,
  type ChatResult,
  type LLMProvider,
} from "@crmwsp/ai";
import type { CipherBox } from "@crmwsp/crypto";
import {
  EncryptionNotConfiguredError,
  ValidationError,
  type AiTurnOutput,
  type SimulateRequest,
  type SimulationResult,
} from "@crmwsp/contracts";
import {
  agentConfigs,
  and,
  eq,
  inArray,
  knowledgeSources,
  llmConnections,
  searchChunks,
  searchChunksText,
  tenants,
  usageLedger,
  type ChunkHit,
  type LlmConnection,
} from "@crmwsp/db";
import { dryRunTurn, toTenantPolicies, type SimulatedChunk } from "@crmwsp/domain";
import { PlanLimitsService } from "../billing/plan-limits.service.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import type { TenantDb } from "../db/tenant-db.js";
import { LLM_API_KEY_PURPOSE } from "./ai.constants.js";
import { LlmProviderFactory } from "./llm-provider.factory.js";

const RETRIEVAL_K = 8;
const QUERY_MESSAGES = 3;
const QUERY_MAX_CHARS = 1_000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
/** Fixed simulated "now" source; the contact is a placeholder, never a real one. */
const SIM_CONTACT = { name: "Cliente de prueba" };

interface ModelCall {
  model: string;
  result: ChatResult<AiTurnOutput>;
}

/** Same matching as the worker (apps/worker/src/ai/common.ts isInvalidOutput). */
function isInvalidOutput(err: unknown): boolean {
  return (
    err instanceof LlmProviderError &&
    !err.retryable &&
    err.status === undefined &&
    /^(Model output|Model returned|Model refused|Unexpected chat response)/.test(err.message)
  );
}

/** Retrieval query: the trailing customer messages (same rule as the worker's buildQuery). */
export function simulationQuery(messages: SimulateRequest["messages"]): string {
  const picked: string[] = [];
  for (let i = messages.length - 1; i >= 0 && picked.length < QUERY_MESSAGES; i--) {
    const m = messages[i]!;
    if (m.author !== "contact") break;
    picked.unshift(m.text.trim());
  }
  return picked.join("\n").slice(0, QUERY_MAX_CHARS);
}

/**
 * F6 dry-run AI turn. Reads config, connection and knowledge, calls the model and the policy
 * engine, and returns what the bot WOULD do. Zero side effects on business data: no messages,
 * conversations, contacts, ai_actions, quotes, orders, notifications, follow-ups, queue jobs nor
 * realtime/webhook/CAPI events. The only writes are the plan's ai_messages counter and
 * usage_ledger rows of kind `simulation` (the tokens are really spent).
 */
@Injectable()
export class SimulatorService {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(LlmProviderFactory) private readonly providers: LlmProviderFactory,
    @Inject(PlanLimitsService) private readonly limits: PlanLimitsService,
  ) {}

  async simulate(db: TenantDb, req: SimulateRequest, now = new Date()): Promise<SimulationResult> {
    const ctx = await db.run(async (tx) => {
      const [conn] = await tx.select().from(llmConnections).where(eq(llmConnections.isActive, true)).limit(1);
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants).limit(1);
      const [config] = await tx.select().from(agentConfigs).where(eq(agentConfigs.isActive, true)).limit(1);
      return { conn, tenantName: tenant?.name ?? "", config };
    });
    const conn = ctx.conn;
    if (!conn || !conn.apiKeyEncrypted) throw new ValidationError("Connect and test an AI provider before simulating");
    if (!this.cipher) throw new EncryptionNotConfiguredError();

    // Counts against the plan like a real AI message; refuses (402) at the cap before spending.
    await this.limits.consume(db.tenantId, "ai_messages", 1);

    const apiKey = this.cipher.decrypt(conn.apiKeyEncrypted, { tenantId: db.tenantId, purpose: LLM_API_KEY_PURPOSE });
    const provider = this.providers.create({
      baseUrl: conn.baseUrl,
      apiKey,
      ...(conn.capabilities.structuredOutput === false ? { supportsJsonSchema: false } : {}),
    });

    const calls: ModelCall[] = [];
    let embedding: { model: string; tokens: number } | undefined;
    try {
      const query = simulationQuery(req.messages);
      let vector: { embedding: number[]; model: string; dims: number } | undefined;
      if (query !== "" && conn.capabilities.embeddings === true) {
        const model = embeddingModelFor(conn);
        try {
          const emb = await provider.embed({ model, input: [query] });
          embedding = { model, tokens: emb.usage.inputTokens };
          const v = emb.vectors[0];
          if (v) vector = { embedding: v, model, dims: emb.dims };
        } catch {
          // Degrades to full-text search, like the worker.
        }
      }
      const { hits, titles } = query === "" ? { hits: [] as ChunkHit[], titles: new Map<string, string>() } : await this.retrieve(db, query, vector);

      const promptSource = req.draftSystemPrompt !== undefined ? "draft" : "active";
      const messageIds = req.messages.map((_, i) => `sim-${i + 1}`);
      const chatMessages = buildAiTurnMessages({
        systemPrompt: req.draftSystemPrompt ?? ctx.config?.systemPrompt ?? "",
        tenantName: ctx.tenantName,
        conversation: req.messages.map((m, i) => ({ messageId: messageIds[i]!, author: m.author, text: m.text, at: now.toISOString() })),
        contact: SIM_CONTACT,
        retrievedChunks: hits.map((h) => {
          const title = titles.get(h.sourceId);
          return { chunkId: h.id, content: h.content, ...(title ? { title } : {}) };
        }),
        nowIso: now.toISOString(),
      });
      await callModel(provider, conn, chatMessages, calls);

      const final = calls[calls.length - 1]!;
      const chunks = new Map<string, SimulatedChunk>(hits.map((h) => [h.id, { sourceTitle: titles.get(h.sourceId) ?? null, content: h.content }]));
      const report = dryRunTurn({
        output: final.result.parsed as AiTurnOutput,
        chunks,
        contextIds: new Set(messageIds),
        confidenceThreshold: ctx.config ? Number(ctx.config.confidenceThreshold) : DEFAULT_CONFIDENCE_THRESHOLD,
        approvalThresholdMinor: Number(ctx.config?.approvalThresholdMinor ?? 0n),
        policies: toTenantPolicies(ctx.config?.policies ?? {}),
        now,
      });
      const usage = summarizeUsage(calls, embedding);
      return { promptSource, model: final.model, retrievedChunks: hits.length, usage, ...report };
    } catch (err) {
      if (err instanceof LlmProviderError) throw new LlmProviderError(`AI provider failed: ${sanitize(err)}`, err.retryable);
      throw err;
    } finally {
      // The provider cost was incurred whatever happened afterwards.
      await this.recordUsage(db, calls, embedding);
    }
  }

  /** Read-only retrieval under RLS; only chunks of active sources at their current version survive. */
  private retrieve(db: TenantDb, query: string, vector: { embedding: number[]; model: string; dims: number } | undefined) {
    return db.run(async (tx) => {
      let hits: ChunkHit[] = [];
      if (vector) hits = await searchChunks(tx, { ...vector, limit: RETRIEVAL_K });
      if (hits.length === 0) hits = await searchChunksText(tx, { query, limit: RETRIEVAL_K });
      const titles = new Map<string, string>();
      if (hits.length > 0) {
        const sources = await tx
          .select({ id: knowledgeSources.id, title: knowledgeSources.title, version: knowledgeSources.version })
          .from(knowledgeSources)
          .where(and(inArray(knowledgeSources.id, [...new Set(hits.map((h) => h.sourceId))]), eq(knowledgeSources.isActive, true)));
        const byId = new Map(sources.map((s) => [s.id, s]));
        hits = hits.filter((h) => byId.get(h.sourceId)?.version === h.sourceVersion);
        for (const s of sources) titles.set(s.id, s.title);
      }
      return { hits, titles };
    });
  }

  private async recordUsage(db: TenantDb, calls: ModelCall[], embedding: { model: string; tokens: number } | undefined): Promise<void> {
    if (calls.length === 0 && !embedding) return;
    await db.run(async (tx) => {
      for (const call of calls) {
        const u = call.result.usage;
        const cost = estimateCost(call.model, u);
        await tx.insert(usageLedger).values({
          tenantId: db.tenantId,
          kind: "simulation",
          quantity: String(u.inputTokens + u.outputTokens),
          unit: "tokens",
          costMinor: BigInt(cost.costMinor),
          currency: cost.currency,
          refType: "simulation",
          meta: {
            model: call.model,
            purpose: "chat",
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            promptVersion: PROMPT_VERSION,
            verified: cost.verified,
            priceKnown: cost.known,
            unit: "usd_microcents",
          },
        });
      }
      if (embedding) {
        const cost = estimateCost(embedding.model, { inputTokens: embedding.tokens });
        await tx.insert(usageLedger).values({
          tenantId: db.tenantId,
          kind: "simulation",
          quantity: String(embedding.tokens),
          unit: "tokens",
          costMinor: BigInt(cost.costMinor),
          currency: cost.currency,
          refType: "simulation",
          meta: { model: embedding.model, purpose: "retrieval_query", verified: cost.verified, priceKnown: cost.known, unit: "usd_microcents" },
        });
      }
    });
  }
}

function embeddingModelFor(conn: LlmConnection): string {
  const configured = (conn.capabilities as { embeddingModel?: unknown }).embeddingModel;
  return typeof configured === "string" && configured.trim() !== "" ? configured.trim() : DEFAULT_EMBEDDING_MODEL;
}

/** Cheap model first; one retry with the strong model on invalid structured output (as the worker). */
async function callModel(provider: LLMProvider, conn: LlmConnection, messages: ChatMessage[], calls: ModelCall[]): Promise<void> {
  const ask = (model: string) => provider.chat({ model, messages, responseFormat: aiTurnResponseFormat });
  for (const model of [conn.modelCheap, conn.modelStrong ?? conn.modelCheap]) {
    try {
      const result = await ask(model);
      calls.push({ model, result });
      if (result.parsed) return;
    } catch (err) {
      if (!isInvalidOutput(err)) throw err;
    }
  }
  throw new LlmProviderError("Model output invalid after retry with the strong model", false);
}

/** Provider messages may echo request data: only a fixed category leaves the API. */
function sanitize(err: LlmProviderError): string {
  if (isInvalidOutput(err) || /^Model output invalid/.test(err.message)) return "invalid_output";
  if (err.retryable) return "provider_unavailable";
  return err.status !== undefined ? `provider_error_${err.status}` : "provider_error";
}

function summarizeUsage(calls: ModelCall[], embedding: { model: string; tokens: number } | undefined): SimulationResult["usage"] {
  let micro = 0;
  let known = true;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const c of calls) {
    const cost = estimateCost(c.model, c.result.usage);
    micro += cost.costMinor;
    known &&= cost.known;
    inputTokens += c.result.usage.inputTokens;
    outputTokens += c.result.usage.outputTokens;
  }
  if (embedding) {
    const cost = estimateCost(embedding.model, { inputTokens: embedding.tokens });
    micro += cost.costMinor;
    known &&= cost.known;
  }
  return { inputTokens, outputTokens, embeddingTokens: embedding?.tokens ?? 0, costUsd: micro / 1e8, priceKnown: known };
}
