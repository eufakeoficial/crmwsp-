import { createHash } from "node:crypto";
import {
  PROMPT_VERSION,
  aiTurnResponseFormat,
  buildAiTurnMessages,
  estimateCost,
  type ChatResult,
  type LLMProvider,
  type PromptChunk,
  type PromptConversationMessage,
} from "@crmwsp/ai";
import { AI_ACTION_TYPES, aiActionSchema } from "@crmwsp/contracts";
import type { AiActionType, AiDecision, AiTurnOutput } from "@crmwsp/contracts";
import { checkLimit, getPlan } from "@crmwsp/billing";
import {
  agentConfigs,
  consumeUsage,
  readPlanUsage,
  aiActions,
  attachments,
  contacts,
  conversations,
  knowledgeSources,
  llmConnections,
  messages,
  searchChunks,
  searchChunksText,
  tenants,
  usageLedger,
  withTenant,
  type AgentPolicies,
  type AiActionStatus,
  type AiCitation,
  type ChunkHit,
  type LlmConnection,
  type Transaction,
} from "@crmwsp/db";
import { evaluateTurn, type TenantAiPolicies } from "@crmwsp/domain";
import { UnrecoverableError } from "bullmq";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { InboxEvent } from "../processors.js";
import { AI_TURN_MAX_ATTEMPTS, SEND_MESSAGE_JOB, SEND_MESSAGE_JOB_OPTIONS } from "../queue.js";
import { insertNotification } from "../notifications/notify.js";
import { applyConversationHandoff, runAction } from "./actions.js";
import { extractReceipt, findPendingPaymentOrder, handleReceipt, pgReceiptPorts, type ReceiptImage } from "./receipt.js";
import { maybeWarnBudget, readBudget } from "./budget.js";
import { withRedisLock } from "./lock.js";
import {
  AUDIO_NOT_TRANSCRIBED,
  DEFAULT_TRANSCRIPTION_MODEL,
  transcribeAttachment,
  voiceNoteText,
  type AudioAttachment,
  type TranscribeOutcome,
} from "./transcribe.js";
import {
  InvalidModelOutputError,
  assertIds,
  buildProvider,
  embeddingModelFor,
  handoffReasonFor,
  isInvalidOutput,
  isRetryableProviderError,
  publishEvents,
  silent,
  type AiDeps,
  type AiEvent,
} from "./common.js";

const HISTORY_LIMIT = 20;
const RETRIEVAL_K = 8;
/** Used when the tenant has no active agent_config. */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
/** Customer messages (since the last non-customer message) joined to form the retrieval query. */
const QUERY_MESSAGES = 3;
const QUERY_MAX_CHARS = 1_000;

export interface AiTurnAttempt {
  /** Attempts already made before this one (BullMQ job.attemptsMade). */
  attemptsMade: number;
  maxAttempts: number;
}

export type AiTurnResult =
  | { outcome: "skipped"; reason: "ai-off" | "already-processed" | "no-llm-connection" }
  | { outcome: "handoff"; reason: string }
  | { outcome: "processed"; replied: boolean; drafted: boolean; handoff: boolean; actionIds: string[] };

interface ModelCall {
  model: string;
  result: ChatResult<AiTurnOutput>;
}

interface TurnTx {
  result: AiTurnResult;
  events: Array<AiEvent | InboxEvent>;
  /** Queued AI reply that must be handed to the `outbound` queue after commit. */
  enqueueMessageId?: string;
  connection?: LlmConnection;
}

const STATUS_FOR_DECISION: Record<AiDecision, AiActionStatus> = {
  auto: "approved",
  approve: "pending_approval",
  deny: "rejected",
};

/** Deterministic UUID so a replayed turn can never insert a second AI reply (unique client_message_id). */
export function aiReplyClientMessageId(triggerMessageId: string): string {
  const h = createHash("sha256").update(`ai-reply:${triggerMessageId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function toTenantPolicies(policies: AgentPolicies): TenantAiPolicies {
  const actionOverrides: Partial<Record<AiActionType, AiDecision>> = {};
  for (const [type, decision] of Object.entries(policies)) {
    if ((AI_ACTION_TYPES as readonly string[]).includes(type)) actionOverrides[type as AiActionType] = decision;
  }
  return { actionOverrides };
}

function flattenExtracted(extracted: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(extracted)) {
    const value = typeof v === "object" && v !== null ? (v as { value?: unknown }).value : v;
    if (typeof value === "string" || typeof value === "number") out[k] = String(value);
  }
  return out;
}

const placeholder = (m: { body: string | null; type: string }): string => m.body?.trim() || `[${m.type}]`;

/** Retrieval query: the customer's latest messages since the last agent/AI/system message. */
function buildQuery(history: Array<{ author: string; body: string | null; type: string }>): string {
  const picked: string[] = [];
  for (let i = history.length - 1; i >= 0 && picked.length < QUERY_MESSAGES; i--) {
    const m = history[i]!;
    if (m.author !== "contact") break;
    const text = m.body?.trim().replace(/^\[voice note\]\s*/, "");
    if (text && text !== AUDIO_NOT_TRANSCRIBED) picked.unshift(text);
  }
  return picked.join("\n").slice(0, QUERY_MAX_CHARS);
}

async function callModel(
  provider: LLMProvider,
  conn: LlmConnection,
  chatMessages: ReturnType<typeof buildAiTurnMessages>,
): Promise<ModelCall[]> {
  const ask = (model: string) => provider.chat({ model, messages: chatMessages, responseFormat: aiTurnResponseFormat });
  const calls: ModelCall[] = [];
  try {
    const result = await ask(conn.modelCheap);
    if (result.parsed) return [{ model: conn.modelCheap, result }];
    calls.push({ model: conn.modelCheap, result });
  } catch (err) {
    if (!isInvalidOutput(err)) throw err;
  }
  // Invalid structured output: one retry with the strong model (falls back to the cheap one if unset).
  const strong = conn.modelStrong ?? conn.modelCheap;
  try {
    const result = await ask(strong);
    if (result.parsed) return [...calls, { model: strong, result }];
  } catch (err) {
    if (!isInvalidOutput(err)) throw err;
  }
  throw new InvalidModelOutputError();
}

/** WhatsApp free-form (session) messages are only allowed within 24 h of the last inbound message. */
export const WHATSAPP_SESSION_WINDOW_MS = 24 * 3600 * 1000;
/** WhatsApp text body limit. */
export const WHATSAPP_TEXT_MAX = 4096;

/**
 * Whether the AI may send a reply on its own in this conversation right now. Anything else gets a
 * draft for a human: AI mode not `auto`, a human assigned (they own the conversation), a
 * conversation in handoff (`pending`) or resolved.
 */
export function aiMayAutoReply(conv: { aiMode: string; assignedUserId: string | null; status: string }): boolean {
  return conv.aiMode === "auto" && conv.assignedUserId === null && conv.status === "open";
}

export function sessionWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < WHATSAPP_SESSION_WINDOW_MS;
}

/**
 * One AI turn for a conversation (ADR 0003: the model proposes, the policy engine decides, the
 * system executes). Turns of one conversation are serialised by a Redis lock (no DB connection is
 * held while waiting). The turn reads its context in a short transaction, calls the LLM outside any
 * transaction, and persists in another short transaction that re-validates the conversation state
 * (a human may have taken it meanwhile). Message text, prompts and the API key are never logged.
 */
export async function processAiTurn(
  deps: AiDeps,
  data: unknown,
  attempt: AiTurnAttempt = { attemptsMade: 0, maxAttempts: AI_TURN_MAX_ATTEMPTS },
): Promise<AiTurnResult> {
  const { tenantId, conversationId, triggerMessageId } = assertIds(data, ["tenantId", "conversationId", "triggerMessageId"]);
  const now = (deps.now ?? (() => new Date()))();

  const out = await withRedisLock(deps.lockRedis, `ai-turn-lock:${tenantId}:${conversationId}`, () =>
    runTurn(deps, { tenantId, conversationId, triggerMessageId, now }, attempt),
  );

  // After commit: hand the reply to the existing outbound flow, then notify. The enqueue may throw
  // (BullMQ retries the turn; the already-processed guard re-enqueues the queued message).
  if (out.enqueueMessageId) {
    await deps.outboundQueue.add(
      SEND_MESSAGE_JOB,
      { tenantId, messageId: out.enqueueMessageId },
      { ...SEND_MESSAGE_JOB_OPTIONS, jobId: out.enqueueMessageId },
    );
  }
  await publishEvents(deps, tenantId, out.events);
  if (out.connection) await maybeWarnBudget(deps, tenantId, out.connection);
  return out.result;
}

interface TurnCtx {
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  now: Date;
}

interface HistoryRow {
  id: string;
  author: string;
  type: string;
  body: string | null;
  createdAt: Date;
}

interface Prepared {
  conn: LlmConnection;
  tenantName: string;
  config: typeof agentConfigs.$inferSelect | undefined;
  contact: typeof contacts.$inferSelect | undefined;
  history: HistoryRow[];
  /** Trigger audio attachment (voice note) and stored transcripts of earlier voice notes by message id. */
  triggerAudio: AudioAttachment | undefined;
  transcripts: Map<string, string>;
  /** Trigger image while the contact has a `pending_payment` order: a receipt to review (T8). */
  receipt?: ReceiptImage;
}

/** Writes handoff rows inside `tx`; the conversation is moved to `pending` at most once. */
function handoffWriter(tx: Transaction, c: TurnCtx, events: Array<AiEvent | InboxEvent>) {
  let handedOff = false;
  const note = async (actionId: string): Promise<void> => {
    if (handedOff) return;
    handedOff = true;
    // Unassigned conversations go to `pending`; an assigned agent already owns it.
    await applyConversationHandoff(tx, c.conversationId, c.now);
    await insertNotification(tx, c.tenantId, {
      kind: "handoff",
      title: "Una conversación necesita atención humana",
      entity: "conversation",
      entityId: c.conversationId,
      conversationId: c.conversationId,
      dedupeKey: `handoff:${actionId}`,
    });
    events.push(
      { type: "ai.handoff", conversationId: c.conversationId, actionId },
      { type: "conversation.updated", conversationId: c.conversationId, messageId: c.triggerMessageId },
    );
  };
  const record = async (reason: string, model: string | null): Promise<string> => {
    const [row] = await tx
      .insert(aiActions)
      .values({
        tenantId: c.tenantId,
        conversationId: c.conversationId,
        messageId: c.triggerMessageId,
        type: "handoff",
        payload: { type: "handoff", reason },
        decision: "auto",
        decisionReason: reason,
        status: "executed",
        result: { applied: true },
        model,
        executedAt: c.now,
      })
      .returning({ id: aiActions.id });
    if (!row) throw new Error("handoff insert returned no row");
    await note(row.id);
    return row.id;
  };
  return { note, record, handedOff: () => handedOff };
}

async function replayGuard(tx: Transaction, c: TurnCtx): Promise<TurnTx | null> {
  const [done] = await tx.select({ id: aiActions.id }).from(aiActions).where(eq(aiActions.messageId, c.triggerMessageId)).limit(1);
  if (!done) return null;
  const [reply] = await tx
    .select({ id: messages.id, status: messages.status, externalId: messages.externalId })
    .from(messages)
    .where(eq(messages.clientMessageId, aiReplyClientMessageId(c.triggerMessageId)))
    .limit(1);
  const lostEnqueue = reply && reply.status === "queued" && !reply.externalId;
  return {
    result: { outcome: "skipped", reason: "already-processed" },
    events: lostEnqueue ? [{ type: "message.created", conversationId: c.conversationId, messageId: reply.id }] : [],
    ...(lostEnqueue ? { enqueueMessageId: reply.id } : {}),
  };
}

/** Phase 1 (short transaction): state checks, budget and context. */
async function prepare(deps: AiDeps, tx: Transaction, c: TurnCtx): Promise<{ done: TurnTx } | { prep: Prepared }> {
  const { conversationId, triggerMessageId } = c;
  const events: Array<AiEvent | InboxEvent> = [];
  const [conv] = await tx
    .select({ id: conversations.id, aiMode: conversations.aiMode, contactId: conversations.contactId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) throw new UnrecoverableError("conversation not found");

  const [trigger] = await tx
    .select({ id: messages.id, direction: messages.direction, conversationId: messages.conversationId, type: messages.type })
    .from(messages)
    .where(eq(messages.id, triggerMessageId))
    .limit(1);
  if (!trigger || trigger.conversationId !== conversationId || trigger.direction !== "inbound") {
    throw new UnrecoverableError("trigger message not found");
  }

  if (conv.aiMode === "off") return { done: { result: { outcome: "skipped", reason: "ai-off" }, events } };

  const replay = await replayGuard(tx, c);
  if (replay) return { done: replay };

  const [conn] = await tx.select().from(llmConnections).where(eq(llmConnections.isActive, true)).limit(1);
  if (!conn || !conn.lastTestOk) return { done: { result: { outcome: "skipped", reason: "no-llm-connection" }, events } };

  // Budget (ADR 0008: at 100 % the automatic AI stops; the inbox never does). Checked before any
  // provider call, the retrieval-query embedding included.
  const budget = await readBudget(tx, conn);
  if (budget.currencyMismatch) {
    (deps.logger ?? silent).warn(`ai-turn ${triggerMessageId}: budget currency is not USD; budget not enforced (no FX conversion)`);
  }
  if (budget.exceeded) {
    await handoffWriter(tx, c, events).record("budget_exceeded", null);
    return { done: { result: { outcome: "handoff", reason: "budget_exceeded" }, events, connection: conn } };
  }

  // Plan limit (monthly AI messages): same contract as the budget, the AI stops, the inbox doesn't.
  const usage = await readPlanUsage(tx);
  if (!checkLimit(getPlan(usage.plan), "ai_messages", usage.aiMessages, 1).allowed) {
    await handoffWriter(tx, c, events).record("plan_limit_reached", null);
    return { done: { result: { outcome: "handoff", reason: "plan_limit_reached" }, events, connection: conn } };
  }

  const [tenant] = await tx.select({ name: tenants.name }).from(tenants).limit(1);
  const [config] = await tx.select().from(agentConfigs).where(eq(agentConfigs.isActive, true)).limit(1);
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, conv.contactId)).limit(1);
  const historyDesc = await tx
    .select({ id: messages.id, author: messages.author, type: messages.type, body: messages.body, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(HISTORY_LIMIT);
  const history = historyDesc.reverse();
  const audioIds = history.filter((m) => m.type === "audio").map((m) => m.id);
  if (trigger.type === "audio" && !audioIds.includes(trigger.id)) audioIds.push(trigger.id);
  const transcripts = new Map<string, string>();
  let triggerAudio: AudioAttachment | undefined;
  if (audioIds.length > 0) {
    const rows = await tx
      .select({
        id: attachments.id,
        messageId: attachments.messageId,
        externalMediaId: attachments.externalMediaId,
        mimeType: attachments.mimeType,
        transcript: attachments.transcript,
      })
      .from(attachments)
      .where(inArray(attachments.messageId, audioIds));
    for (const r of rows) {
      if (r.transcript?.trim()) transcripts.set(r.messageId, r.transcript.trim());
      if (r.messageId === triggerMessageId && !triggerAudio) triggerAudio = r;
    }
  }
  let receipt: ReceiptImage | undefined;
  if (trigger.type === "image") {
    const order = await findPendingPaymentOrder(tx, conv.contactId);
    if (order) {
      const [img] = await tx
        .select({ id: attachments.id, externalMediaId: attachments.externalMediaId, mimeType: attachments.mimeType })
        .from(attachments)
        .where(eq(attachments.messageId, triggerMessageId))
        .limit(1);
      receipt = { attachmentId: img?.id ?? null, externalMediaId: img?.externalMediaId ?? null, mimeType: img?.mimeType ?? null, order };
    }
  }
  return {
    prep: { conn, tenantName: tenant?.name ?? "", config, contact, history, triggerAudio, transcripts, ...(receipt ? { receipt } : {}) },
  };
}

/**
 * Retrieval (short transaction): RLS + `currentTenant()` scope the search to this tenant; then only
 * chunks of active sources at their current version survive. The result is the ONLY set of chunk
 * ids a citation may point to.
 */
async function retrieve(tx: Transaction, query: string, vector: { embedding: number[]; model: string; dims: number } | undefined) {
  let hits: ChunkHit[] = [];
  if (vector) hits = await searchChunks(tx, { ...vector, limit: RETRIEVAL_K });
  if (hits.length === 0) hits = await searchChunksText(tx, { query, limit: RETRIEVAL_K });
  let sourceTitles = new Map<string, string>();
  if (hits.length > 0) {
    const sources = await tx
      .select({ id: knowledgeSources.id, title: knowledgeSources.title, version: knowledgeSources.version })
      .from(knowledgeSources)
      .where(and(inArray(knowledgeSources.id, [...new Set(hits.map((h) => h.sourceId))]), eq(knowledgeSources.isActive, true)));
    const byId = new Map(sources.map((s) => [s.id, s]));
    hits = hits.filter((h) => byId.get(h.sourceId)?.version === h.sourceVersion);
    sourceTitles = new Map(sources.map((s) => [s.id, s.title]));
  }
  return { hits, sourceTitles };
}

async function runTurn(deps: AiDeps, c: TurnCtx, attempt: AiTurnAttempt): Promise<TurnTx> {
  const { tenantId, triggerMessageId, now } = c;
  const logger = deps.logger ?? silent;

  // 1. Short read transaction.
  const phase1 = await withTenant(deps.db, tenantId, (tx) => prepare(deps, tx, c));
  if ("done" in phase1) return phase1.done;
  const { conn, tenantName, config, contact, triggerAudio, transcripts } = phase1.prep;

  // Receipt image for a pending order: extract for a human reviewer; never marks the order paid.
  if (phase1.prep.receipt) {
    const image = phase1.prep.receipt;
    const out = await handleReceipt(
      {
        inTx: pgReceiptPorts(deps.db, tenantId, c.conversationId, triggerMessageId),
        extract: async () => {
          let provider: LLMProvider;
          try {
            provider = buildProvider(deps, tenantId, conn);
          } catch (err) {
            logger.warn(`receipt provider unavailable (${err instanceof Error ? err.name : "unknown"})`);
            return { status: "failed", reason: "credentials_unavailable" };
          }
          return extractReceipt(image, {
            tenantId,
            conversationId: c.conversationId,
            provider,
            supported: conn.capabilities.vision === true,
            model: visionModelFor(conn),
            loadMedia: deps.loadMedia,
            logger,
          });
        },
        canAutoReply: (conv) => aiMayAutoReply(conv) && sessionWindowOpen(conv.lastInboundAt, now),
        replyClientMessageId: aiReplyClientMessageId(triggerMessageId),
      },
      { conversationId: c.conversationId, messageId: triggerMessageId, image },
    );
    if (out.outcome === "already-processed") {
      return {
        result: { outcome: "skipped", reason: "already-processed" },
        events: out.events,
        ...(out.enqueueMessageId ? { enqueueMessageId: out.enqueueMessageId } : {}),
      };
    }
    return {
      result: { outcome: "processed", replied: out.replied, drafted: false, handoff: false, actionIds: [] },
      events: out.events,
      ...(out.enqueueMessageId ? { enqueueMessageId: out.enqueueMessageId } : {}),
      connection: conn,
    };
  }
  let history = phase1.prep.history;
  const contextIds = new Set(history.map((m) => m.id));
  const confidenceThreshold = config ? Number(config.confidenceThreshold) : DEFAULT_CONFIDENCE_THRESHOLD;

  // 2. Provider calls, outside any transaction (no pooled connection held while the LLM thinks).
  let calls: ModelCall[];
  let hits: ChunkHit[] = [];
  let queryEmbeddingTokens: { model: string; tokens: number } | undefined;
  try {
    const provider = buildProvider(deps, tenantId, conn);

    // Voice note: transcribe once (BYOK provider), persist, and let the turn see the text.
    // Any failure degrades to a marker; the transcript is stored before the chat call so a retry
    // of this job never pays for the same audio twice.
    if (triggerAudio) {
      const outcome = await transcribeAttachment(triggerAudio, {
        tenantId,
        conversationId: c.conversationId,
        provider,
        supported: conn.capabilities.transcription === true,
        model: transcriptionModelFor(conn),
        loadMedia: deps.loadMedia,
        logger,
      });
      if (outcome.status === "transcribed") {
        try {
          await withTenant(deps.db, tenantId, (tx) => persistTranscript(tx, c, triggerAudio.id, outcome));
        } catch (err) {
          logger.warn(`ai-turn ${triggerMessageId} could not persist transcript (${err instanceof Error ? err.name : "unknown"})`);
        }
      } else if (outcome.status !== "cached") {
        logger.warn(`ai-turn ${triggerMessageId} voice note not transcribed (${outcome.reason})`);
      }
      const text = outcome.status === "cached" || outcome.status === "transcribed" ? outcome.text : undefined;
      if (text) transcripts.set(triggerMessageId, text);
      history = history.map((m) =>
        m.type === "audio" && m.id === triggerMessageId ? { ...m, body: voiceNoteText(outcome) } : m,
      );
    }
    // Earlier voice notes with a stored transcript.
    history = history.map((m) =>
      m.type === "audio" && !m.body?.trim() && transcripts.has(m.id) ? { ...m, body: `[voice note] ${transcripts.get(m.id)}` } : m,
    );
    const query = buildQuery(history);
    let sourceTitles = new Map<string, string>();
    if (query !== "") {
      let vector: { embedding: number[]; model: string; dims: number } | undefined;
      if (conn.capabilities.embeddings === true) {
        const model = embeddingModelFor(deps, conn);
        try {
          const emb = await provider.embed({ model, input: [query] });
          queryEmbeddingTokens = { model, tokens: emb.usage.inputTokens };
          const v = emb.vectors[0];
          if (v) vector = { embedding: v, model, dims: emb.dims };
        } catch (err) {
          // Embedding failures degrade to full-text search instead of failing the turn.
          logger.warn(`query embedding failed (${err instanceof Error ? err.name : "unknown"}); using full-text search`);
        }
      }
      const r = await withTenant(deps.db, tenantId, (tx) => retrieve(tx, query, vector));
      hits = r.hits;
      sourceTitles = r.sourceTitles;
    }

    const promptMessages: PromptConversationMessage[] = history
      .filter((m) => m.author !== "system")
      .map((m) => ({
        messageId: m.id,
        author: m.author === "contact" ? "contact" : m.author === "ai" ? "ai" : "agent",
        text: placeholder(m),
        at: m.createdAt.toISOString(),
      }));
    const retrievedChunks: PromptChunk[] = hits.map((h) => {
      const title = sourceTitles.get(h.sourceId);
      return { chunkId: h.id, content: h.content, ...(title ? { title } : {}) };
    });
    const chatMessages = buildAiTurnMessages({
      systemPrompt: config?.systemPrompt ?? "",
      tenantName,
      conversation: promptMessages,
      contact: { name: contact?.name, phone: contact?.phoneE164, ...flattenExtracted(contact?.extracted ?? {}) },
      retrievedChunks,
      nowIso: now.toISOString(),
    });
    calls = await callModel(provider, conn, chatMessages);
  } catch (err) {
    const reason = handoffReasonFor(err);
    if (reason === null) throw err;
    const lastAttempt = attempt.attemptsMade + 1 >= attempt.maxAttempts;
    if (isRetryableProviderError(err) && !lastAttempt) {
      logger.warn(`ai-turn ${triggerMessageId} transient provider failure (attempt ${attempt.attemptsMade + 1})`);
      throw err; // nothing persisted; BullMQ retries with backoff
    }
    const events: Array<AiEvent | InboxEvent> = [];
    const handed = await withTenant(deps.db, tenantId, async (tx) => {
      if (await replayGuard(tx, c)) return false;
      await recordUsage(tx, c, [], queryEmbeddingTokens);
      await handoffWriter(tx, c, events).record(reason, null);
      return true;
    });
    if (!handed) return { result: { outcome: "skipped", reason: "already-processed" }, events: [] };
    logger.warn(`ai-turn ${triggerMessageId} handed off (${reason})`);
    return { result: { outcome: "handoff", reason }, events, connection: conn };
  }

  // 3. Short persistence transaction.
  return withTenant(deps.db, tenantId, (tx) =>
    persist(tx, c, { conn, config, calls, hits, contextIds, confidenceThreshold, queryEmbeddingTokens }),
  );
}

function visionModelFor(conn: LlmConnection): string {
  const configured = conn.capabilities.visionModel;
  return typeof configured === "string" && configured.trim() !== "" ? configured.trim() : conn.modelCheap;
}

function transcriptionModelFor(conn: LlmConnection): string {
  const configured = (conn.capabilities as { transcriptionModel?: unknown }).transcriptionModel;
  return typeof configured === "string" && configured.trim() !== "" ? configured.trim() : DEFAULT_TRANSCRIPTION_MODEL;
}

/** Stores the transcript once (first writer wins) and books the transcription cost in the ledger. */
async function persistTranscript(
  tx: Transaction,
  c: TurnCtx,
  attachmentId: string,
  t: Extract<TranscribeOutcome, { status: "transcribed" }>,
): Promise<void> {
  await tx
    .update(attachments)
    .set({ transcript: t.text })
    .where(and(eq(attachments.id, attachmentId), sql`${attachments.transcript} is null`));
  await tx.insert(usageLedger).values({
    tenantId: c.tenantId,
    kind: "transcription_seconds",
    quantity: String(t.seconds),
    unit: "seconds",
    costMinor: BigInt(t.costMinor),
    currency: "USD",
    refType: "conversation",
    refId: c.conversationId,
    meta: {
      model: t.model,
      attachmentId,
      messageId: c.triggerMessageId,
      durationEstimated: t.durationEstimated,
      verified: t.verified,
      priceKnown: t.priceKnown,
      unit: "usd_microcents",
    },
  });
}

async function recordUsage(
  tx: Transaction,
  c: TurnCtx,
  calls: ModelCall[],
  queryEmbeddingTokens: { model: string; tokens: number } | undefined,
): Promise<void> {
  for (const call of calls) {
    const usage = call.result.usage;
    const cost = estimateCost(call.model, usage);
    await tx.insert(usageLedger).values({
      tenantId: c.tenantId,
      kind: "llm_tokens",
      quantity: String(usage.inputTokens + usage.outputTokens),
      unit: "tokens",
      costMinor: BigInt(cost.costMinor),
      currency: cost.currency,
      refType: "conversation",
      refId: c.conversationId,
      meta: {
        model: call.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        promptVersion: PROMPT_VERSION,
        structuredMode: call.result.structuredMode ?? null,
        verified: cost.verified,
        priceKnown: cost.known,
        unit: "usd_microcents",
      },
    });
  }
  if (queryEmbeddingTokens) {
    const cost = estimateCost(queryEmbeddingTokens.model, { inputTokens: queryEmbeddingTokens.tokens });
    await tx.insert(usageLedger).values({
      tenantId: c.tenantId,
      kind: "embedding_tokens",
      quantity: String(queryEmbeddingTokens.tokens),
      unit: "tokens",
      costMinor: BigInt(cost.costMinor),
      currency: cost.currency,
      refType: "conversation",
      refId: c.conversationId,
      meta: { model: queryEmbeddingTokens.model, purpose: "retrieval_query", verified: cost.verified, priceKnown: cost.known, unit: "usd_microcents" },
    });
  }
}

interface PersistInput {
  conn: LlmConnection;
  config: Prepared["config"];
  calls: ModelCall[];
  hits: ChunkHit[];
  contextIds: Set<string>;
  confidenceThreshold: number;
  queryEmbeddingTokens: { model: string; tokens: number } | undefined;
}

async function persist(tx: Transaction, c: TurnCtx, p: PersistInput): Promise<TurnTx> {
  const { tenantId, conversationId, triggerMessageId, now } = c;
  const events: Array<AiEvent | InboxEvent> = [];

  // The provider cost was incurred whatever happens next.
  await recordUsage(tx, c, p.calls, p.queryEmbeddingTokens);
  // One AI message per turn that reached the provider. Recorded uncapped: the cap is enforced
  // before the provider call (prepare), and the cost was incurred anyway.
  if (p.calls.length > 0) await consumeUsage(tx, tenantId, "ai_messages", 1, null);

  // Re-validate under a row lock: the conversation may have changed while the LLM was thinking.
  const [conv] = await tx
    .select({
      aiMode: conversations.aiMode,
      assignedUserId: conversations.assignedUserId,
      status: conversations.status,
      lastInboundAt: conversations.lastInboundAt,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
    .for("update");
  if (!conv) throw new UnrecoverableError("conversation not found");
  if (conv.aiMode === "off") return { result: { outcome: "skipped", reason: "ai-off" }, events, connection: p.conn };
  const replay = await replayGuard(tx, c);
  if (replay) return { ...replay, connection: p.conn };

  const handoff = handoffWriter(tx, c, events);
  const final = p.calls[p.calls.length - 1]!;
  const output = final.result.parsed as AiTurnOutput;
  const modelUsed = final.model;
  // Auto only when nobody (human or handoff) owns the conversation; otherwise drafts.
  const mode: "auto" | "assist" = aiMayAutoReply(conv) ? "auto" : "assist";

  const validChunkIds = new Set(p.hits.map((h) => h.id));
  const chunkCitations = new Map<string, AiCitation>(
    p.hits.map((h) => [h.id, { chunkId: h.id, sourceId: h.sourceId, sourceVersion: h.sourceVersion }]),
  );
  const evaluation = evaluateTurn(output, {
    validChunkIds,
    confidenceThreshold: p.confidenceThreshold,
    approvalThresholdMinor: Number(p.config?.approvalThresholdMinor ?? 0n),
    policies: toTenantPolicies(p.config?.policies ?? {}),
    now,
    mode,
  });

  const actionIds: string[] = [];
  let hasHandoffAction = false;
  for (const ev of evaluation.actions) {
    const parsed = aiActionSchema.safeParse(ev.action);
    const action = parsed.success ? parsed.data : undefined;
    let decision = ev.decision;
    let decisionReason = ev.reason;
    // Contact data must come from a message the model actually saw.
    if (action?.type === "update_contact_field" && decision === "auto" && !p.contextIds.has(action.sourceMessageId)) {
      decision = "approve";
      decisionReason = `${decisionReason}; source message not in context`;
    }
    const citedChunkIds = action?.type === "create_quote_draft" ? action.items.map((i) => i.chunkId) : [];
    const [row] = await tx
      .insert(aiActions)
      .values({
        tenantId,
        conversationId,
        messageId: triggerMessageId,
        type: action?.type ?? "unknown",
        payload: action ? { ...action } : {},
        citations: citedChunkIds.flatMap((id) => chunkCitations.get(id) ?? []),
        confidence: String(action?.type === "update_contact_field" ? action.confidence : output.confidence),
        decision,
        decisionReason,
        status: STATUS_FOR_DECISION[decision],
        model: modelUsed,
      })
      .returning({ id: aiActions.id });
    if (!row) throw new Error("ai action insert returned no row");
    actionIds.push(row.id);

    if (action?.type === "handoff") {
      if (decision !== "deny") {
        hasHandoffAction = true;
        await tx.update(aiActions).set({ status: "executed", result: { applied: true }, executedAt: now }).where(eq(aiActions.id, row.id));
        await handoff.note(row.id);
      }
    } else if (decision === "auto") {
      const outcome = await runAction(tx, { id: row.id, conversationId, type: action?.type ?? "unknown", payload: action ? { ...action } : {} }, now);
      await tx
        .update(aiActions)
        .set({ status: outcome.status, result: outcome.result, ...(outcome.status === "approved" ? {} : { executedAt: now }) })
        .where(eq(aiActions.id, row.id));
    } else if (decision === "approve") {
      await insertNotification(tx, tenantId, {
        kind: "approval_requested",
        title: "La IA pide aprobación para una acción",
        body: action?.type ?? null,
        entity: "ai_action",
        entityId: row.id,
        conversationId,
        dedupeKey: `approval:${row.id}`,
      });
      events.push({ type: "ai.action_pending", conversationId, actionId: row.id });
    }
  }

  // Reply.
  let replied = false;
  let drafted = false;
  let enqueueMessageId: string | undefined;
  const reply = output.reply;
  if (reply && evaluation.reply.allowed) {
    const citations = [...new Set(reply.claims.flatMap((cl) => cl.citations.map((ci) => ci.chunkId)))].flatMap(
      (id) => chunkCitations.get(id) ?? [],
    );
    // Hard send gates on top of the policy: WhatsApp 24 h session window and text length.
    let draftReason: string | null = null;
    if (mode === "assist" || evaluation.reply.draft) draftReason = evaluation.reply.reason;
    else if (!sessionWindowOpen(conv.lastInboundAt, now)) draftReason = "whatsapp 24h window closed; draft only";
    else if (reply.text.length > WHATSAPP_TEXT_MAX) draftReason = "reply exceeds 4096 characters; draft only";

    if (draftReason !== null) {
      const [row] = await tx
        .insert(aiActions)
        .values({
          tenantId,
          conversationId,
          messageId: triggerMessageId,
          type: "draft_reply",
          payload: { text: reply.text, claims: reply.claims },
          citations,
          confidence: String(output.confidence),
          decision: "approve",
          decisionReason: draftReason,
          status: "proposed",
          model: modelUsed,
        })
        .returning({ id: aiActions.id });
      if (!row) throw new Error("draft insert returned no row");
      actionIds.push(row.id);
      drafted = true;
      events.push({ type: "ai.reply_drafted", conversationId, actionId: row.id });
    } else {
      const [msg] = await tx
        .insert(messages)
        .values({
          tenantId,
          conversationId,
          direction: "outbound",
          type: "text",
          body: reply.text,
          status: "queued",
          author: "ai",
          clientMessageId: aiReplyClientMessageId(triggerMessageId),
        })
        .onConflictDoNothing({
          target: [messages.tenantId, messages.clientMessageId],
          where: sql`${messages.clientMessageId} is not null`,
        })
        .returning({ id: messages.id, createdAt: messages.createdAt });
      if (!msg) throw new Error("ai reply already exists for this trigger");
      // messages has no ai_action_id column yet (pending migration): the link lives in this
      // action's `result.messageId`.
      const [row] = await tx
        .insert(aiActions)
        .values({
          tenantId,
          conversationId,
          messageId: triggerMessageId,
          type: "send_reply",
          payload: { text: reply.text },
          citations,
          confidence: String(output.confidence),
          decision: "auto",
          decisionReason: evaluation.reply.reason,
          status: "executed",
          result: { messageId: msg.id },
          model: modelUsed,
          executedAt: now,
        })
        .returning({ id: aiActions.id });
      if (!row) throw new Error("reply action insert returned no row");
      actionIds.push(row.id);
      const ts = msg.createdAt.toISOString();
      await tx
        .update(conversations)
        .set({
          lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${ts}::timestamptz), ${ts}::timestamptz)`,
          updatedAt: now,
        })
        .where(eq(conversations.id, conversationId));
      replied = true;
      enqueueMessageId = msg.id;
      events.push({ type: "message.created", conversationId, messageId: msg.id });
    }
  } else if (reply && !evaluation.reply.allowed && !hasHandoffAction) {
    // Reply proposed but refused and the engine did not add a handoff: a human must answer.
    actionIds.push(await handoff.record(evaluation.reply.reason.slice(0, 200), modelUsed));
  }

  return {
    result: { outcome: "processed", replied, drafted, handoff: handoff.handedOff(), actionIds },
    events,
    connection: p.conn,
    ...(enqueueMessageId ? { enqueueMessageId } : {}),
  };
}
