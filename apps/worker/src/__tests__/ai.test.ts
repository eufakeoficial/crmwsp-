import { randomUUID } from "node:crypto";
import { PROMPT_VERSION } from "@crmwsp/ai";
import type { CipherBox } from "@crmwsp/crypto";
import {
  aiActions,
  auditEvents,
  contacts,
  conversations,
  knowledgeChunks,
  knowledgeSources,
  llmConnections,
  users,
  messages,
  usageLedger,
  withTenant,
  type DbHandle,
} from "@crmwsp/db";
import { GupshupProvider } from "@crmwsp/whatsapp";
import { Queue, UnrecoverableError } from "bullmq";
import { and, eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LlmProviderError } from "@crmwsp/ai";
import {
  InvalidModelOutputError,
  createAiWorker,
  handoffReasonFor,
  isInvalidOutput,
  processAiTurn,
  processEmbedSource,
  processExecuteAiAction,
  type AiDeps,
} from "../ai/index.js";
import { processIngestMessage } from "../processors.js";
import { AI_QUEUE_NAME, createRedis, SEND_MESSAGE_JOB, aiTurnJobId, AI_TURN_JOB } from "../queue.js";
import {
  APP_URL,
  MIGRATOR_URL,
  REDIS_URL,
  createDb,
  dropTenants,
  hasEnv,
  ingest,
  textPayload,
} from "./helpers.js";
import {
  LLM_KEY,
  capturePublisher,
  makeCipher,
  mockLlm,
  publicLookup,
  seedAiTenant,
  seedConversation,
  seedKnowledge,
  sleep,
  turnJson,
  type AiTenant,
  type MockLlm,
} from "./ai-helpers.js";

describe.skipIf(!hasEnv)("AI worker (Postgres + Redis, mocked LLM fetch)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let cipher: CipherBox;
  let redis: Redis;
  let outbound: Queue;
  const tenants: string[] = [];
  const createdUsers: string[] = [];
  const pub = capturePublisher();

  const deps = (llm: MockLlm, extra: Partial<AiDeps> = {}): AiDeps => ({
    db: app.db,
    cipher,
    publisher: pub.publisher,
    outboundQueue: outbound,
    lockRedis: redis,
    fetch: llm.fetch,
    lookup: publicLookup,
    ...extra,
  });
  const tenant = async (opts: Parameters<typeof seedAiTenant>[2] = {}): Promise<AiTenant> => {
    const t = await seedAiTenant(migrator, cipher, opts);
    tenants.push(t.tenantId);
    return t;
  };
  const queued = () => outbound.getJobCountByTypes("waiting", "delayed", "active");
  const turnData = (t: AiTenant, conversationId: string, triggerMessageId: string) => ({
    tenantId: t.tenantId,
    conversationId,
    triggerMessageId,
  });
  const actionsOf = (t: AiTenant, conversationId: string) =>
    migrator.db.select().from(aiActions).where(and(eq(aiActions.tenantId, t.tenantId), eq(aiActions.conversationId, conversationId)));
  const messagesOf = (conversationId: string) =>
    migrator.db.select().from(messages).where(eq(messages.conversationId, conversationId));
  const convOf = async (id: string) => (await migrator.db.select().from(conversations).where(eq(conversations.id, id)))[0]!;
  const eventsOf = (type: string, conversationId?: string) =>
    pub.events.filter((e) => e.event.type === type && (conversationId === undefined || e.event.conversationId === conversationId));
  const ledgerOf = (t: AiTenant, kind: "llm_tokens" | "embedding_tokens") =>
    migrator.db.select().from(usageLedger).where(and(eq(usageLedger.tenantId, t.tenantId), eq(usageLedger.kind, kind)));

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 12 });
    cipher = makeCipher();
    redis = createRedis(REDIS_URL as string);
    outbound = new Queue(`outbound-test-${randomUUID()}`, { connection: createRedis(REDIS_URL as string) });
  });

  afterAll(async () => {
    await outbound?.obliterate({ force: true }).catch(() => undefined);
    await outbound?.close();
    redis?.disconnect();
    if (migrator) {
      await dropTenants(migrator, tenants);
      for (const id of createdUsers) await migrator.db.delete(users).where(eq(users.id, id));
      await migrator.close();
    }
    if (app) await app.close();
  });

  // ---------------------------------------------------------------- embed-source

  it("embed-source stores vectors + ledger in batches of 64 and is idempotent", async () => {
    const t = await tenant();
    const { sourceId, chunkIds } = await seedKnowledge(migrator, t, Array.from({ length: 70 }, (_, i) => `Chunk numero ${i}`));
    const llm = mockLlm(() => "unused");

    const r = await processEmbedSource(deps(llm), { tenantId: t.tenantId, sourceId });
    expect(r).toEqual({ outcome: "embedded", chunks: 70, model: "text-embedding-3-small" });
    expect(llm.embedCalls().map((c) => c.body.input?.length)).toEqual([64, 6]);
    expect(llm.calls[0]?.authorization).toBe(`Bearer ${LLM_KEY}`);

    const rows = await migrator.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, sourceId));
    expect(rows).toHaveLength(70);
    expect(rows.every((c) => c.embeddingModel === "text-embedding-3-small" && c.embeddingDims === 3 && c.embedding?.length === 3)).toBe(true);
    expect(chunkIds).toHaveLength(70);

    const ledger = await ledgerOf(t, "embedding_tokens");
    expect(ledger).toHaveLength(2);
    expect(ledger.map((l) => Number(l.quantity)).sort((a, b) => a - b)).toEqual([30, 320]);
    expect(ledger[0]?.meta).toMatchObject({ model: "text-embedding-3-small", dims: 3, verified: false, priceKnown: true });
    expect(ledger[0]?.refId).toBe(sourceId);

    // Second run: nothing to do, no calls, no ledger rows.
    const again = await processEmbedSource(deps(llm), { tenantId: t.tenantId, sourceId });
    expect(again).toMatchObject({ outcome: "embedded", chunks: 0 });
    expect(llm.embedCalls()).toHaveLength(2);
    expect(await ledgerOf(t, "embedding_tokens")).toHaveLength(2);

    // A different configured model re-embeds (vectors of another model are not comparable).
    await migrator.db
      .update(llmConnections)
      .set({ capabilities: { structuredOutput: true, embeddings: true, embeddingModel: "text-embedding-3-large" } as never })
      .where(eq(llmConnections.id, t.connectionRowId));
    const third = await processEmbedSource(deps(llm), { tenantId: t.tenantId, sourceId });
    expect(third).toMatchObject({ chunks: 70, model: "text-embedding-3-large" });
  });

  it("embed-source without embeddings capability or connection ends quietly", async () => {
    const noCap = await tenant({ capabilities: { structuredOutput: true, embeddings: false } });
    const noConn = await tenant({ connection: false });
    const llm = mockLlm(() => "unused");
    for (const t of [noCap, noConn]) {
      const { sourceId } = await seedKnowledge(migrator, t, ["Hola"]);
      expect(await processEmbedSource(deps(llm), { tenantId: t.tenantId, sourceId })).toEqual({ outcome: "skipped", reason: "no-embeddings" });
    }
    expect(llm.calls).toHaveLength(0);
  });

  // ---------------------------------------------------------------- ai-turn

  it("auto turn with a cited reply queues the message and enqueues send-message", async () => {
    const t = await tenant();
    const { sourceId, chunkIds } = await seedKnowledge(migrator, t, ["El corte de pelo cuesta 25 EUR.", "Abrimos de lunes a viernes."]);
    const conv = await seedConversation(migrator, t, "auto", "¿Cuánto cuesta el corte?");
    const llm = mockLlm((call) => {
      // The retrieved chunk id must be visible to the model.
      expect(call.body.messages?.[1]?.content).toContain(`chunkId="${chunkIds[0]}"`);
      return turnJson({
        reply: {
          text: "El corte cuesta 25 EUR.",
          claims: [{ kind: "price", text: "El corte cuesta 25 EUR", citations: [{ chunkId: chunkIds[0]! }] }],
        },
      });
    });
    await processEmbedSource(deps(llm), { tenantId: t.tenantId, sourceId });
    const out = await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toMatchObject({ outcome: "processed", replied: true, drafted: false, handoff: false });

    const [reply] = (await messagesOf(conv.conversationId)).filter((m) => m.author === "ai");
    expect(reply).toMatchObject({ direction: "outbound", status: "queued", body: "El corte cuesta 25 EUR.", externalId: null });
    const job = await outbound.getJob(reply!.id);
    expect(job?.name).toBe(SEND_MESSAGE_JOB);
    expect(job?.data).toEqual({ tenantId: t.tenantId, messageId: reply!.id });

    const sent = (await actionsOf(t, conv.conversationId)).find((a) => a.type === "send_reply");
    expect(sent).toMatchObject({ status: "executed", decision: "auto", model: "gpt-5-mini" });
    expect(sent?.result).toEqual({ messageId: reply!.id });
    expect(sent?.citations).toEqual([{ chunkId: chunkIds[0], sourceId, sourceVersion: 1 }]);

    const [llmRow] = await ledgerOf(t, "llm_tokens");
    expect(Number(llmRow?.quantity)).toBe(150);
    expect(llmRow?.meta).toMatchObject({ promptVersion: PROMPT_VERSION, inputTokens: 100, outputTokens: 50, model: "gpt-5-mini" });
    expect(await ledgerOf(t, "embedding_tokens")).toHaveLength(2); // source batch + retrieval query
    expect(eventsOf("message.created", conv.conversationId)).toHaveLength(1);

    // Replaying the same trigger is a no-op (no second LLM call, no second message).
    const calls = llm.chatCalls().length;
    expect(await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!))).toEqual({
      outcome: "skipped",
      reason: "already-processed",
    });
    expect(llm.chatCalls()).toHaveLength(calls);
    expect((await messagesOf(conv.conversationId)).filter((m) => m.author === "ai")).toHaveLength(1);
  });

  it("without embeddings the turn retrieves with full-text search", async () => {
    const t = await tenant({ capabilities: { structuredOutput: true, embeddings: false } });
    const { chunkIds } = await seedKnowledge(migrator, t, ["Garantia de dos anos en todas las reparaciones."]);
    const conv = await seedConversation(migrator, t, "assist", "garantia reparaciones");
    const llm = mockLlm((call) => {
      expect(call.body.messages?.[1]?.content).toContain(chunkIds[0]);
      return turnJson();
    });
    await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(llm.embedCalls()).toHaveLength(0);
    expect(llm.chatCalls()).toHaveLength(1);
  });

  it("a price without citation hands off and sends nothing", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "auto", "¿Cuánto cuesta?");
    const queuedBefore = await queued();
    const llm = mockLlm(() =>
      turnJson({ reply: { text: "Cuesta 40 EUR.", claims: [{ kind: "price", text: "Cuesta 40 EUR", citations: [] }] } }),
    );
    const out = await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toMatchObject({ outcome: "processed", replied: false, handoff: true });
    expect((await messagesOf(conv.conversationId)).filter((m) => m.direction === "outbound")).toHaveLength(0);
    expect(await queued()).toBe(queuedBefore);
    const acts = await actionsOf(t, conv.conversationId);
    expect(acts.find((a) => a.type === "handoff")).toMatchObject({ status: "executed", decision: "auto" });
    expect(acts.some((a) => a.type === "send_reply" || a.type === "draft_reply")).toBe(false);
    expect((await convOf(conv.conversationId)).status).toBe("pending");
    expect(eventsOf("ai.handoff", conv.conversationId)).toHaveLength(1);
  });

  it("assist mode stores a draft_reply and sends nothing", async () => {
    const t = await tenant();
    const { chunkIds } = await seedKnowledge(migrator, t, ["Entrega en 3 dias habiles."]);
    const conv = await seedConversation(migrator, t, "assist", "entrega dias");
    const queuedBefore = await queued();
    const llm = mockLlm(() =>
      turnJson({
        reply: { text: "Entregamos en 3 dias.", claims: [{ kind: "lead_time", text: "3 dias", citations: [{ chunkId: chunkIds[0]! }] }] },
      }),
    );
    const out = await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toMatchObject({ outcome: "processed", replied: false, drafted: true });
    expect((await messagesOf(conv.conversationId)).filter((m) => m.direction === "outbound")).toHaveLength(0);
    const draft = (await actionsOf(t, conv.conversationId)).find((a) => a.type === "draft_reply");
    expect(draft).toMatchObject({ status: "proposed", payload: { text: "Entregamos en 3 dias." } });
    expect(draft?.citations).toHaveLength(1);
    expect(eventsOf("ai.reply_drafted", conv.conversationId)).toHaveLength(1);
    expect(await queued()).toBe(queuedBefore);
  });

  it("a discount stays pending_approval; auto actions run, including create_task", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "auto", "Soy Ana de Madrid, quiero un descuento");
    const llm = mockLlm(() =>
      turnJson({
        actions: [
          { type: "apply_discount", percent: 10 },
          { type: "update_contact_field", field: "city", value: "Madrid", confidence: 0.95, sourceMessageId: conv.firstMessageId },
          { type: "create_task", title: "Llamar a Ana", dueAt: null },
        ],
      }),
    );
    await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    const acts = await actionsOf(t, conv.conversationId);
    const by = (type: string) => acts.find((a) => a.type === type)!;
    expect(by("apply_discount")).toMatchObject({ decision: "approve", status: "pending_approval", executedAt: null });
    expect(eventsOf("ai.action_pending", conv.conversationId)).toHaveLength(1);
    expect(by("update_contact_field")).toMatchObject({ decision: "auto", status: "executed" });
    expect(by("create_task")).toMatchObject({ decision: "auto", status: "executed", result: { applied: true } });
    expect(by("create_task").executedAt).not.toBeNull();
    const [contact] = await migrator.db.select().from(contacts).where(eq(contacts.id, conv.contactId));
    expect(contact?.extracted).toMatchObject({
      city: { value: "Madrid", confidence: 0.95, sourceMessageId: conv.firstMessageId },
    });
    expect((contact?.extracted["city"] as { updatedAt: string }).updatedAt).toMatch(/^\d{4}-/);
  });

  it("with the monthly budget exhausted the LLM is not called", async () => {
    const t = await tenant({ budgetMinor: 100n });
    // 100 minor units = 100_000_000 micro-cents of spend.
    await migrator.db.insert(usageLedger).values({ tenantId: t.tenantId, kind: "llm_tokens", quantity: "1", unit: "tokens", costMinor: 100_000_000n, currency: "USD" });
    const conv = await seedConversation(migrator, t, "auto", "Hola");
    const llm = mockLlm(() => turnJson());
    const out = await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toEqual({ outcome: "handoff", reason: "budget_exceeded" });
    expect(llm.calls).toHaveLength(0);
    const handoff = (await actionsOf(t, conv.conversationId)).find((a) => a.type === "handoff");
    expect(handoff).toMatchObject({ payload: { type: "handoff", reason: "budget_exceeded" }, status: "executed" });
    expect((await convOf(conv.conversationId)).status).toBe("pending");
    expect(eventsOf("ai.handoff", conv.conversationId)).toHaveLength(1);
  });

  it("the 80% budget warning is published once per month", async () => {
    const t = await tenant({ budgetMinor: 100n });
    await migrator.db.insert(usageLedger).values({ tenantId: t.tenantId, kind: "llm_tokens", quantity: "1", unit: "tokens", costMinor: 80_000_000n, currency: "USD" });
    const llm = mockLlm(() => turnJson());
    const c1 = await seedConversation(migrator, t, "assist", "uno");
    const c2 = await seedConversation(migrator, t, "assist", "dos");
    // Concurrent turns on different conversations must not both warn.
    await Promise.all([
      processAiTurn(deps(llm), turnData(t, c1.conversationId, c1.firstMessageId!)),
      processAiTurn(deps(llm), turnData(t, c2.conversationId, c2.firstMessageId!)),
    ]);
    const c3 = await seedConversation(migrator, t, "assist", "tres");
    await processAiTurn(deps(llm), turnData(t, c3.conversationId, c3.firstMessageId!));
    const warnings = pub.events.filter((e) => e.channel === `tenant:${t.tenantId}:events` && e.event.type === "ai.budget_warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.event).toMatchObject({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
    const markers = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, t.tenantId), eq(auditEvents.action, "ai.budget_warning")));
    expect(markers).toHaveLength(1);
    expect(llm.chatCalls()).toHaveLength(3); // the turn itself still runs below 100 %
  });

  it("invalid output retries once with the strong model, then hands off", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "auto", "Hola");
    const llm = mockLlm((_, n) => (n === 0 ? "esto no es json" : "{}"));
    const out = await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toEqual({ outcome: "handoff", reason: "invalid_output" });
    expect(llm.chatCalls().map((c) => c.body.model)).toEqual(["gpt-5-mini", "gpt-5"]);
    const acts = await actionsOf(t, conv.conversationId);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ type: "handoff", payload: { reason: "invalid_output" } });
    expect((await messagesOf(conv.conversationId)).filter((m) => m.direction === "outbound")).toHaveLength(0);
  });

  it("invalid output followed by a valid strong-model answer is used", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "assist", "Hola");
    const llm = mockLlm((_, n) => (n === 0 ? "{" : turnJson({ reply: { text: "Hola, ¿en qué te ayudo?", claims: [] } })));
    const out = await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toMatchObject({ outcome: "processed", drafted: true });
    expect((await actionsOf(t, conv.conversationId)).find((a) => a.type === "draft_reply")?.model).toBe("gpt-5");
    expect(await ledgerOf(t, "llm_tokens")).toHaveLength(1);
  });

  it("a 503 is retried by BullMQ with backoff and then succeeds", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "assist", "Hola");
    const llm = mockLlm((_, n) => (n === 0 ? new Response("upstream down", { status: 503 }) : turnJson({ reply: { text: "Hola", claims: [] } })));

    // Direct call: a transient error rolls back and is rethrown for BullMQ.
    const direct = mockLlm(() => new Response("x", { status: 503 }));
    await expect(processAiTurn(deps(direct), turnData(t, conv.conversationId, conv.firstMessageId!))).rejects.toMatchObject({ retryable: true });
    expect(await actionsOf(t, conv.conversationId)).toHaveLength(0);
    // On the last attempt it becomes a handoff with a sanitized reason.
    const last = await processAiTurn(deps(direct), turnData(t, conv.conversationId, conv.firstMessageId!), { attemptsMade: 2, maxAttempts: 3 });
    expect(last).toEqual({ outcome: "handoff", reason: "provider_unavailable" });

    // Through a real worker + queue: first attempt 503, second succeeds.
    const t2 = await tenant();
    const conv2 = await seedConversation(migrator, t2, "assist", "Hola");
    const queue = new Queue(`ai-test-${randomUUID()}`, { connection: createRedis(REDIS_URL as string) });
    const worker = createAiWorker({ ...deps(llm), connection: createRedis(REDIS_URL as string), queueName: queue.name, concurrency: 1 });
    try {
      const done = new Promise<void>((resolve, reject) => {
        worker.on("completed", () => resolve());
        worker.on("failed", (job, err) => {
          if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) reject(err);
        });
      });
      await queue.add(AI_TURN_JOB, turnData(t2, conv2.conversationId, conv2.firstMessageId!), {
        attempts: 3,
        backoff: { type: "fixed", delay: 50 },
      });
      await done;
      expect(llm.chatCalls()).toHaveLength(2);
      expect((await actionsOf(t2, conv2.conversationId)).some((a) => a.type === "draft_reply")).toBe(true);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  }, 20_000);

  it("two jobs of the same conversation run one at a time", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "assist", "primer mensaje");
    const second = await conv.inbound("segundo mensaje");
    let inFlight = 0;
    let maxInFlight = 0;
    const llm = mockLlm(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(200);
      inFlight--;
      return turnJson();
    });
    await Promise.all([
      processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!)),
      processAiTurn(deps(llm), turnData(t, conv.conversationId, second)),
    ]);
    expect(llm.chatCalls()).toHaveLength(2);
    expect(maxInFlight).toBe(1);
    // The later job sees both customer messages.
    expect(llm.chatCalls()[1]?.body.messages?.[1]?.content).toContain("segundo mensaje");
  }, 20_000);

  it("never leaks the key or message text to logs and ignores conversations with AI off", async () => {
    const t = await tenant();
    const off = await seedConversation(migrator, t, "off", "Hola");
    const llm = mockLlm(() => turnJson());
    const logs: string[] = [];
    const logger = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
    expect(await processAiTurn(deps(llm, { logger }), turnData(t, off.conversationId, off.firstMessageId!))).toEqual({ outcome: "skipped", reason: "ai-off" });
    expect(llm.calls).toHaveLength(0);

    const conv = await seedConversation(migrator, t, "auto", "mensaje secreto del cliente");
    const failing = mockLlm(() => new Response("boom", { status: 500 }));
    await processAiTurn(deps(failing, { logger }), turnData(t, conv.conversationId, conv.firstMessageId!), { attemptsMade: 2, maxAttempts: 3 });
    expect(logs.join("\n")).not.toContain(LLM_KEY);
    expect(logs.join("\n")).not.toContain("secreto");
  });

  it("a tenant cannot see or run another tenant's AI data", async () => {
    const A = await tenant();
    const B = await tenant();
    const conv = await seedConversation(migrator, A, "assist", "Hola");
    const llm = mockLlm(() => turnJson({ reply: { text: "Hola", claims: [] } }));
    await processAiTurn(deps(llm), turnData(A, conv.conversationId, conv.firstMessageId!));
    expect((await actionsOf(A, conv.conversationId)).length).toBeGreaterThan(0);

    const seenByB = await withTenant(app.db, B.tenantId, (tx) => tx.select().from(aiActions));
    expect(seenByB).toHaveLength(0);
    const ledgerSeenByB = await withTenant(app.db, B.tenantId, (tx) => tx.select().from(usageLedger));
    expect(ledgerSeenByB).toHaveLength(0);

    // B cannot run a turn on A's conversation, nor execute A's action.
    await expect(processAiTurn(deps(llm), turnData(B, conv.conversationId, conv.firstMessageId!))).rejects.toBeInstanceOf(UnrecoverableError);
    const [action] = await actionsOf(A, conv.conversationId);
    await expect(processExecuteAiAction(deps(llm), { tenantId: B.tenantId, actionId: action!.id })).rejects.toBeInstanceOf(UnrecoverableError);
  });

  // ---------------------------------------------------------------- execute-ai-action

  it("execute-ai-action runs approved actions once", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "assist", "Soy de Sevilla");
    const insert = async (type: string, payload: Record<string, unknown>, status: "approved" | "pending_approval") => {
      const [row] = await migrator.db
        .insert(aiActions)
        .values({ tenantId: t.tenantId, conversationId: conv.conversationId, messageId: conv.firstMessageId!, type, payload, decision: "approve", status })
        .returning({ id: aiActions.id });
      return row!.id;
    };
    const llm = mockLlm(() => "unused");
    const field = await insert(
      "update_contact_field",
      { type: "update_contact_field", field: "city", value: "Sevilla", confidence: 0.9, sourceMessageId: conv.firstMessageId },
      "approved",
    );
    const discount = await insert("apply_discount", { type: "apply_discount", percent: 10 }, "approved");
    const task = await insert("create_task", { type: "create_task", title: "Llamar" }, "approved");
    const pending = await insert("apply_discount", { type: "apply_discount", percent: 5 }, "pending_approval");
    const get = async (id: string) => (await migrator.db.select().from(aiActions).where(eq(aiActions.id, id)))[0]!;

    expect(await processExecuteAiAction(deps(llm), { tenantId: t.tenantId, actionId: field })).toEqual({ outcome: "executed" });
    const first = await get(field);
    expect(first).toMatchObject({ status: "executed", result: { applied: true, field: "city" } });
    expect(first.executedAt).not.toBeNull();
    const [c1] = await migrator.db.select().from(contacts).where(eq(contacts.id, conv.contactId));
    const stamp = (c1?.extracted["city"] as { updatedAt: string }).updatedAt;

    // Replay: untouched.
    await sleep(15);
    expect(await processExecuteAiAction(deps(llm), { tenantId: t.tenantId, actionId: field })).toEqual({ outcome: "skipped", reason: "not-approved" });
    const [c2] = await migrator.db.select().from(contacts).where(eq(contacts.id, conv.contactId));
    expect((c2?.extracted["city"] as { updatedAt: string }).updatedAt).toBe(stamp);

    // Concurrent duplicates execute exactly once.
    const dup = await insert(
      "update_contact_field",
      { type: "update_contact_field", field: "company", value: "ACME", confidence: 0.9, sourceMessageId: conv.firstMessageId },
      "approved",
    );
    const runs = await Promise.all([1, 2, 3].map(() => processExecuteAiAction(deps(llm), { tenantId: t.tenantId, actionId: dup })));
    expect(runs.filter((r) => r.outcome === "executed")).toHaveLength(1);

    // No draft quote in this conversation: the discount fails cleanly (details in sales-actions.test.ts).
    expect(await processExecuteAiAction(deps(llm), { tenantId: t.tenantId, actionId: discount })).toEqual({ outcome: "failed" });
    expect(await get(discount)).toMatchObject({ status: "failed", result: { error: "no_draft_quote" } });
    expect(await processExecuteAiAction(deps(llm), { tenantId: t.tenantId, actionId: task })).toEqual({ outcome: "executed" });
    expect(await get(task)).toMatchObject({ status: "executed", result: { applied: true } });
    expect(await processExecuteAiAction(deps(llm), { tenantId: t.tenantId, actionId: pending })).toEqual({ outcome: "skipped", reason: "not-approved" });
    expect((await get(pending)).status).toBe("pending_approval");
  });

  // ---------------------------------------------------------------- ingest -> ai queue

  it("ingest schedules ai-turn only with AI enabled and a tested connection", async () => {
    const withLlm = await tenant();
    const noLlm = await tenant({ connection: false });
    const aiQueue = new Queue(`${AI_QUEUE_NAME}-test-${randomUUID()}`, { connection: createRedis(REDIS_URL as string) });
    const ingestDeps = { db: app.db, provider: new GupshupProvider(), publisher: pub.publisher, aiQueue };
    const post = async (t: AiTenant, phone: string) => {
      const id = `ext-${randomUUID()}`;
      const eventId = await ingest(app, t.token, `msg:${id}`, textPayload(id, phone));
      return processIngestMessage(ingestDeps, { eventId, tenantId: t.tenantId });
    };
    try {
      // New conversations start with ai_mode = off: nothing is scheduled.
      const first = await post(withLlm, "5491100000101");
      expect(await aiQueue.getJob(aiTurnJobId(first.messageId))).toBeUndefined();

      await migrator.db.update(conversations).set({ aiMode: "auto" }).where(eq(conversations.id, first.conversationId));
      const second = await post(withLlm, "5491100000101");
      const job = await aiQueue.getJob(aiTurnJobId(second.messageId));
      expect(job?.name).toBe(AI_TURN_JOB);
      expect(job?.data).toEqual({ tenantId: withLlm.tenantId, conversationId: second.conversationId, triggerMessageId: second.messageId });

      // Connection not tested ok -> no job.
      await migrator.db.update(llmConnections).set({ lastTestOk: false }).where(eq(llmConnections.id, withLlm.connectionRowId));
      const third = await post(withLlm, "5491100000101");
      expect(await aiQueue.getJob(aiTurnJobId(third.messageId))).toBeUndefined();

      // No connection at all -> no job.
      const n1 = await post(noLlm, "5491100000102");
      await migrator.db.update(conversations).set({ aiMode: "auto" }).where(eq(conversations.id, n1.conversationId));
      const n2 = await post(noLlm, "5491100000102");
      expect(await aiQueue.getJob(aiTurnJobId(n2.messageId))).toBeUndefined();
    } finally {
      await aiQueue.obliterate({ force: true }).catch(() => undefined);
      await aiQueue.close();
    }
  });

  // ---------------------------------------------------------------- gate F2-F

  const seedUser = async (): Promise<string> => {
    const [u] = await migrator.db.insert(users).values({ email: `agent-${randomUUID()}@example.test` }).returning({ id: users.id });
    createdUsers.push(u!.id);
    return u!.id;
  };
  const greeting = () => turnJson({ reply: { text: "Hola, ¿en qué te ayudo?", claims: [] } });

  it("auto mode with a human assigned only drafts and sends nothing", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "auto", "Hola");
    await migrator.db.update(conversations).set({ assignedUserId: await seedUser() }).where(eq(conversations.id, conv.conversationId));
    const queuedBefore = await queued();
    const llm = mockLlm(() => greeting());
    const out = await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toMatchObject({ outcome: "processed", replied: false, drafted: true });
    expect((await messagesOf(conv.conversationId)).filter((m) => m.direction === "outbound")).toHaveLength(0);
    expect(await queued()).toBe(queuedBefore);
  });

  it("a human taking the conversation while the LLM thinks turns the reply into a draft", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "auto", "Hola");
    const userId = await seedUser();
    const llm = mockLlm(async () => {
      await migrator.db.update(conversations).set({ assignedUserId: userId }).where(eq(conversations.id, conv.conversationId));
      return greeting();
    });
    const out = await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toMatchObject({ outcome: "processed", replied: false, drafted: true });
    expect((await messagesOf(conv.conversationId)).filter((m) => m.direction === "outbound")).toHaveLength(0);
  });

  it("a conversation in handoff (pending) is not answered automatically", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "auto", "Hola");
    await migrator.db.update(conversations).set({ status: "pending" }).where(eq(conversations.id, conv.conversationId));
    const out = await processAiTurn(deps(mockLlm(() => greeting())), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toMatchObject({ replied: false, drafted: true });
  });

  it("with the WhatsApp 24 h window closed the reply is only drafted", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "auto", "Hola");
    await migrator.db
      .update(conversations)
      .set({ lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000) })
      .where(eq(conversations.id, conv.conversationId));
    const queuedBefore = await queued();
    const out = await processAiTurn(deps(mockLlm(() => greeting())), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toMatchObject({ replied: false, drafted: true });
    const draft = (await actionsOf(t, conv.conversationId)).find((a) => a.type === "draft_reply");
    expect(draft?.decisionReason).toContain("24h");
    expect(await queued()).toBe(queuedBefore);
  });

  it("a reply over 4096 characters is rejected as invalid output and never sent", async () => {
    const t = await tenant();
    const conv = await seedConversation(migrator, t, "auto", "Hola");
    const llm = mockLlm(() => turnJson({ reply: { text: "a".repeat(4097), claims: [] } }));
    const out = await processAiTurn(deps(llm), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toEqual({ outcome: "handoff", reason: "invalid_output" });
    expect((await messagesOf(conv.conversationId)).filter((m) => m.direction === "outbound")).toHaveLength(0);
  });

  it("citing a real chunk of another tenant or of an inactive source blocks the reply", async () => {
    const A = await tenant({ capabilities: { structuredOutput: true, embeddings: false } });
    const B = await tenant({ capabilities: { structuredOutput: true, embeddings: false } });
    const own = await seedKnowledge(migrator, A, ["corte precio informacion general"]);
    const inactive = await seedKnowledge(migrator, A, ["corte precio 10 EUR antiguo"]);
    await migrator.db.update(knowledgeSources).set({ isActive: false }).where(eq(knowledgeSources.id, inactive.sourceId));
    const foreign = await seedKnowledge(migrator, B, ["corte precio 25 EUR"]);

    for (const cited of [foreign.chunkIds[0]!, inactive.chunkIds[0]!]) {
      const conv = await seedConversation(migrator, A, "auto", "corte precio");
      const queuedBefore = await queued();
      const llm = mockLlm((call) => {
        const prompt = call.body.messages?.[1]?.content ?? "";
        expect(prompt).toContain(own.chunkIds[0]);
        expect(prompt).not.toContain(cited);
        return turnJson({ reply: { text: "Cuesta 25 EUR.", claims: [{ kind: "price", text: "25 EUR", citations: [{ chunkId: cited }] }] } });
      });
      const out = await processAiTurn(deps(llm), turnData(A, conv.conversationId, conv.firstMessageId!));
      expect(out).toMatchObject({ outcome: "processed", replied: false, drafted: false, handoff: true });
      expect((await messagesOf(conv.conversationId)).filter((m) => m.direction === "outbound")).toHaveLength(0);
      expect(await queued()).toBe(queuedBefore);
    }
  });

  it("the LLM runs outside any transaction: ingest is not blocked while it thinks", async () => {
    const small = createDb(APP_URL as string, { max: 1 });
    try {
      const t = await tenant();
      const other = await tenant();
      const conv = await seedConversation(migrator, t, "auto", "Hola");
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let thinkingStarted!: () => void;
      const thinking = new Promise<void>((r) => (thinkingStarted = r));
      const llm = mockLlm(async () => {
        thinkingStarted();
        await Promise.race([released, sleep(5_000)]);
        return greeting();
      });
      const turn = processAiTurn({ ...deps(llm), db: small.db }, turnData(t, conv.conversationId, conv.firstMessageId!));
      await thinking;
      const id = `ext-${randomUUID()}`;
      const eventId = await ingest(app, other.token, `msg:${id}`, textPayload(id, "5491100000999"));
      const started = Date.now();
      const ingested = await processIngestMessage(
        { db: small.db, provider: new GupshupProvider(), publisher: pub.publisher },
        { eventId, tenantId: other.tenantId },
      );
      const elapsed = Date.now() - started;
      release();
      expect(ingested.duplicate).toBe(false);
      expect(elapsed).toBeLessThan(2_000);
      expect(await turn).toMatchObject({ outcome: "processed", replied: true });
    } finally {
      await small.close();
    }
  }, 20_000);

  it("a non-USD budget is not enforced without FX conversion but logs a warning", async () => {
    const t = await tenant({ budgetMinor: 100n });
    await migrator.db.update(llmConnections).set({ budgetCurrency: "EUR" }).where(eq(llmConnections.id, t.connectionRowId));
    await migrator.db.insert(usageLedger).values({ tenantId: t.tenantId, kind: "llm_tokens", quantity: "1", unit: "tokens", costMinor: 500_000_000n, currency: "USD" });
    const conv = await seedConversation(migrator, t, "assist", "Hola");
    const logs: string[] = [];
    const logger = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
    const llm = mockLlm(() => greeting());
    const out = await processAiTurn(deps(llm, { logger }), turnData(t, conv.conversationId, conv.firstMessageId!));
    expect(out).toMatchObject({ outcome: "processed" });
    expect(llm.chatCalls()).toHaveLength(1);
    expect(logs.some((l) => l.includes("not USD"))).toBe(true);
    expect(logs.join("\n")).not.toContain("Hola");
  });
});

describe("isInvalidOutput (pins the message-based detector; see DEBT in common.ts)", () => {
  it.each([
    ["Model output failed schema validation", true],
    ["Model returned invalid JSON", true],
    ["Model refused to answer", true],
    ["Unexpected chat response shape", true],
  ])("%s -> %s", (message, expected) => {
    expect(isInvalidOutput(new LlmProviderError(message, false))).toBe(expected);
  });

  it("does not match transport/HTTP failures or other errors", () => {
    expect(isInvalidOutput(new LlmProviderError("Model output failed schema validation", true))).toBe(false);
    expect(isInvalidOutput(new LlmProviderError("Model returned invalid JSON", false, 400))).toBe(false);
    expect(isInvalidOutput(new LlmProviderError("LLM request failed", false))).toBe(false);
    expect(isInvalidOutput(new Error("Model output failed schema validation"))).toBe(false);
    expect(handoffReasonFor(new InvalidModelOutputError())).toBe("invalid_output");
  });
});
