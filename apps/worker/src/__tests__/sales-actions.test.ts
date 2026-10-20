import { randomUUID } from "node:crypto";
import {
  aiActions,
  knowledgeChunks,
  knowledgeSources,
  opportunities,
  opportunityStageHistory,
  pipelineStages,
  products,
  quoteItems,
  quotes,
  tasks,
  type DbHandle,
} from "@crmwsp/db";
import { Queue } from "bullmq";
import { and, desc, eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processExecuteAiAction, type AiDeps } from "../ai/index.js";
import { createRedis } from "../queue.js";
import { APP_URL, MIGRATOR_URL, REDIS_URL, createDb, dropTenants, hasEnv } from "./helpers.js";
import { capturePublisher, makeCipher, mockLlm, seedAiTenant, seedConversation, type AiTenant } from "./ai-helpers.js";

describe.skipIf(!hasEnv)("approved sales actions (create_task, move_stage, create_quote_draft, apply_discount)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let redis: Redis;
  let outbound: Queue;
  const tenantIds: string[] = [];
  const pub = capturePublisher();
  const llm = mockLlm(() => "unused");

  const deps = (): AiDeps => ({ db: app.db, cipher: makeCipher(), publisher: pub.publisher, outboundQueue: outbound, lockRedis: redis, fetch: llm.fetch });

  async function setup() {
    const t: AiTenant = await seedAiTenant(migrator, makeCipher(), { connection: false });
    tenantIds.push(t.tenantId);
    const conv = await seedConversation(migrator, t, "assist", "Hola");
    return { t, conv };
  }
  async function act(t: AiTenant, conversationId: string, type: string, payload: Record<string, unknown>) {
    const [row] = await migrator.db
      .insert(aiActions)
      .values({ tenantId: t.tenantId, conversationId, type, payload: { type, ...payload }, decision: "approve", status: "approved" })
      .returning({ id: aiActions.id });
    const out = await processExecuteAiAction(deps(), { tenantId: t.tenantId, actionId: row!.id });
    const [after] = await migrator.db.select().from(aiActions).where(eq(aiActions.id, row!.id));
    return { out, after: after!, id: row!.id };
  }
  async function catalogChunk(t: AiTenant, metadata: Record<string, unknown>) {
    const [s] = await migrator.db.insert(knowledgeSources).values({ tenantId: t.tenantId, kind: "csv", title: "Catálogo", status: "ready" }).returning({ id: knowledgeSources.id });
    const [c] = await migrator.db
      .insert(knowledgeChunks)
      .values({ tenantId: t.tenantId, sourceId: s!.id, sourceVersion: 1, ordinal: 0, content: "x", metadata: { kind: "catalog_item", currency: "EUR", ...metadata } })
      .returning({ id: knowledgeChunks.id });
    return c!.id;
  }

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 8 });
    redis = createRedis(REDIS_URL as string);
    outbound = new Queue(`outbound-test-${randomUUID()}`, { connection: createRedis(REDIS_URL as string) });
  });
  afterAll(async () => {
    await outbound?.obliterate({ force: true }).catch(() => undefined);
    await outbound?.close();
    redis?.disconnect();
    if (migrator) {
      await dropTenants(migrator, tenantIds);
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("create_task inserts a task linked to the conversation and the action", async () => {
    const { t, conv } = await setup();
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const { out, after, id } = await act(t, conv.conversationId, "create_task", { title: "Llamar a Ana", dueAt: due });
    expect(out).toEqual({ outcome: "executed" });
    expect(after).toMatchObject({ status: "executed", result: { applied: true } });
    const rows = await migrator.db.select().from(tasks).where(eq(tasks.tenantId, t.tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Llamar a Ana", origin: "ai", status: "open", conversationId: conv.conversationId, aiActionId: id });
    expect(rows[0]!.dueAt?.toISOString()).toBe(due);
    // Replaying the job does nothing.
    expect(await processExecuteAiAction(deps(), { tenantId: t.tenantId, actionId: id })).toEqual({ outcome: "skipped", reason: "not-approved" });
    expect(await migrator.db.select().from(tasks).where(eq(tasks.tenantId, t.tenantId))).toHaveLength(1);
  });

  it("move_stage creates the opportunity when missing (seeding the pipeline) and then moves it, with ai history", async () => {
    const { t, conv } = await setup();
    const first = await act(t, conv.conversationId, "move_stage", { stage: "Interesado" });
    expect(first.after.status).toBe("failed");
    expect(first.after.result).toMatchObject({ error: "stage_not_found" });

    const created = await act(t, conv.conversationId, "move_stage", { stage: "Calificado" });
    expect(created.after).toMatchObject({ status: "executed", result: { applied: true, created: true } });
    const [opp] = await migrator.db.select().from(opportunities).where(eq(opportunities.conversationId, conv.conversationId));
    expect(opp).toMatchObject({ source: "ai", title: "Ana" });

    const moved = await act(t, conv.conversationId, "move_stage", { stage: "quote_sent" });
    expect(moved.after.result).toMatchObject({ applied: true, created: false });
    const same = await act(t, conv.conversationId, "move_stage", { stage: "Presupuesto enviado" });
    expect(same.after.result).toMatchObject({ applied: false, unchanged: true });
    const won = await act(t, conv.conversationId, "move_stage", { stage: "ganado" });
    expect(won.after.status).toBe("executed");

    const [after] = await migrator.db.select().from(opportunities).where(eq(opportunities.id, opp!.id));
    expect(after!.wonAt).not.toBeNull();
    expect(after!.lockVersion).toBe(2);
    const hist = await migrator.db.select().from(opportunityStageHistory).where(eq(opportunityStageHistory.opportunityId, opp!.id)).orderBy(opportunityStageHistory.createdAt);
    expect(hist.map((h) => h.changedByType)).toEqual(["ai", "ai", "ai"]);
    expect(hist[0]!.fromStageId).toBeNull();
    const stages = await migrator.db.select().from(pipelineStages).where(eq(pipelineStages.tenantId, t.tenantId));
    expect(stages.find((s) => s.id === after!.stageId)?.kind).toBe("won");

    // The opportunity is closed now: the next move opens a fresh one.
    const again = await act(t, conv.conversationId, "move_stage", { stage: "nuevo" });
    expect(again.after.result).toMatchObject({ created: true });
  });

  it("create_quote_draft prices lines from chunk metadata or the linked product", async () => {
    const { t, conv } = await setup();
    const plain = await catalogChunk(t, { name: "Instalación", sku: "INS-1", price_minor: 7800, unit: "unidad" });
    const linkedChunk = await catalogChunk(t, { name: "Obsoleto", price_minor: 1 });
    await migrator.db.insert(products).values({
      tenantId: t.tenantId,
      name: "Split 3000",
      priceMinor: 40_000n,
      currency: "EUR",
      taxRateBp: 2100,
      priceSource: "knowledge",
      knowledgeChunkId: linkedChunk,
    });
    const { after } = await act(t, conv.conversationId, "create_quote_draft", {
      items: [{ chunkId: plain, quantity: 2 }, { chunkId: linkedChunk, quantity: 1.5 }],
    });
    expect(after.status).toBe("executed");
    const [q] = await migrator.db.select().from(quotes).where(eq(quotes.tenantId, t.tenantId));
    expect(q).toMatchObject({ status: "draft", createdByType: "ai", conversationId: conv.conversationId, currency: "EUR" });
    expect(q!.number).toMatch(/^PRE-\d{4}-0001$/);
    const items = await migrator.db.select().from(quoteItems).where(eq(quoteItems.quoteId, q!.id)).orderBy(quoteItems.position);
    expect(items.map((i) => [i.description, i.quantityMilli, i.unitPriceMinor, i.lineTotalMinor, i.knowledgeChunkId])).toEqual([
      ["Instalación", 2000n, 7800n, 15_600n, plain],
      ["Split 3000", 1500n, 40_000n, 72_600n, linkedChunk], // 60.000 + 21%
    ]);
    expect(q!.totalMinor).toBe(88_200n);
    expect(q!.taxMinor).toBe(12_600n);
    expect(q!.validUntil.getTime()).toBeGreaterThan(Date.now() + 14 * 86_400_000);
  });

  it("create_quote_draft fails cleanly on unpriced chunks, mixed currencies and unknown chunks (nothing written)", async () => {
    const { t, conv } = await setup();
    const noPrice = await catalogChunk(t, { name: "Sin precio" });
    const usd = await catalogChunk(t, { name: "Dólares", price_minor: 100, currency: "USD" });
    const eur = await catalogChunk(t, { name: "Euros", price_minor: 100 });
    expect((await act(t, conv.conversationId, "create_quote_draft", { items: [{ chunkId: noPrice, quantity: 1 }] })).after.result).toMatchObject({ error: "no_price" });
    expect((await act(t, conv.conversationId, "create_quote_draft", { items: [{ chunkId: eur, quantity: 1 }, { chunkId: usd, quantity: 1 }] })).after.result).toMatchObject({ error: "mixed_currency" });
    expect((await act(t, conv.conversationId, "create_quote_draft", { items: [{ chunkId: randomUUID(), quantity: 1 }] })).after.result).toMatchObject({ error: "chunk_not_found" });
    expect(await migrator.db.select().from(quotes).where(eq(quotes.tenantId, t.tenantId))).toHaveLength(0);
  });

  it("apply_discount discounts every line of the latest draft quote and recomputes totals", async () => {
    const { t, conv } = await setup();
    const c1 = await catalogChunk(t, { name: "A", price_minor: 10_000 });
    const c2 = await catalogChunk(t, { name: "B", price_minor: 5_000 });
    await act(t, conv.conversationId, "create_quote_draft", { items: [{ chunkId: c1, quantity: 1 }, { chunkId: c2, quantity: 2 }] });
    const { after } = await act(t, conv.conversationId, "apply_discount", { percent: 10 });
    expect(after).toMatchObject({ status: "executed", result: { applied: true, discountBp: 1000, totalMinor: 18_000 } });
    const [q] = await migrator.db.select().from(quotes).where(and(eq(quotes.tenantId, t.tenantId))).orderBy(desc(quotes.createdAt));
    expect(q).toMatchObject({ subtotalMinor: 20_000n, discountMinor: 2_000n, totalMinor: 18_000n, lockVersion: 1 });
    const items = await migrator.db.select().from(quoteItems).where(eq(quoteItems.quoteId, q!.id));
    expect(items.every((i) => i.discountBp === 1000)).toBe(true);

    expect((await act(t, conv.conversationId, "apply_discount", { percent: 0 })).after.result).toMatchObject({ error: "invalid_percent" });
    expect((await act(t, conv.conversationId, "apply_discount", { percent: 150 })).after.result).toMatchObject({ error: "invalid_percent" });
    // Not a draft anymore: nothing to discount.
    await migrator.db.update(quotes).set({ status: "approved" }).where(eq(quotes.id, q!.id));
    expect((await act(t, conv.conversationId, "apply_discount", { percent: 5 })).after.result).toMatchObject({ error: "no_draft_quote" });
  });

  it("a quote approval record approves its quote; send_template stays deferred", async () => {
    const { t, conv } = await setup();
    const c = await catalogChunk(t, { name: "A", price_minor: 10_000 });
    await act(t, conv.conversationId, "create_quote_draft", { items: [{ chunkId: c, quantity: 1 }] });
    const [q] = await migrator.db.select().from(quotes).where(eq(quotes.tenantId, t.tenantId));
    await migrator.db.update(quotes).set({ status: "pending_approval" }).where(eq(quotes.id, q!.id));
    const rec = await act(t, conv.conversationId, "create_quote_draft", { quoteId: q!.id });
    expect(rec.after).toMatchObject({ status: "executed", result: { applied: true, approvalRecord: true } });
    expect((await migrator.db.select().from(quotes).where(eq(quotes.id, q!.id)))[0]!.status).toBe("approved");
    expect(await migrator.db.select().from(quotes).where(eq(quotes.tenantId, t.tenantId))).toHaveLength(1);

    const tpl = await act(t, conv.conversationId, "send_template", { templateName: "seguimiento" });
    expect(tpl.out).toEqual({ outcome: "approved" });
    expect(tpl.after).toMatchObject({ status: "approved", executedAt: null, result: { deferred: true } });
  });
});
