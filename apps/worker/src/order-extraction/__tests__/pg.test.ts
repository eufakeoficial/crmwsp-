import { randomUUID } from "node:crypto";
import { attachments, messages, orderExtractions, productVariants, products, quoteItems, quotes, usageLedger, type DbHandle } from "@crmwsp/db";
import { parsePdf } from "@crmwsp/knowledge";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_URL, MIGRATOR_URL, createDb, dropTenants, hasEnv } from "../../__tests__/helpers.js";
import { capturePublisher, makeCipher, mockLlm, publicLookup, seedAiTenant, seedConversation, type AiTenant } from "../../__tests__/ai-helpers.js";
import { AI_TURN_JOB, aiTurnJobId } from "../../queue.js";
import { processExtractOrder, type OrderExtractionWorkerDeps } from "../worker.js";

const MODEL_JSON = JSON.stringify({
  items: [
    { rawText: "12 cajas del modelo A", quantity: 12, unit: "cajas", productGuess: "modelo A" },
    { rawText: "6 del B", quantity: 6, unit: null, productGuess: "modelo B" },
  ],
  notes: null,
});

/** Minimal one-page PDF with a text layer (same construction as the knowledge tests). */
function makePdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe.skipIf(!hasEnv)("extract-order with Postgres (mocked LLM): exactly one reply per inbound media", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const tenantIds: string[] = [];
  const cipher = makeCipher();
  const pub = capturePublisher();
  const llm = mockLlm((call) => (JSON.stringify(call.body).includes("PEDIDO") || JSON.stringify(call.body).includes("modelo A") ? MODEL_JSON : JSON.stringify({ items: [], notes: null })));

  beforeAll(() => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 4 });
  });
  afterAll(async () => {
    if (migrator) {
      await dropTenants(migrator, tenantIds);
      await migrator.close();
    }
    if (app) await app.close();
  });

  async function setup(opts: { mime: string; transcript?: string; vision?: boolean }) {
    const t: AiTenant = await seedAiTenant(migrator, cipher, {
      capabilities: { structuredOutput: true, embeddings: true, ...(opts.vision ? { vision: true } : {}) },
    });
    tenantIds.push(t.tenantId);
    const conv = await seedConversation(migrator, t, "auto");
    const [m] = await migrator.db
      .insert(messages)
      .values({ tenantId: t.tenantId, conversationId: conv.conversationId, direction: "inbound", type: "audio", externalId: `wamid-${randomUUID()}`, status: "received", author: "contact" })
      .returning({ id: messages.id });
    await migrator.db.insert(attachments).values({ tenantId: t.tenantId, messageId: m!.id, mimeType: opts.mime, externalMediaId: "media-1", transcript: opts.transcript ?? null });
    const [a] = await migrator.db
      .insert(products)
      .values({ tenantId: t.tenantId, name: "Modelo A", unit: "caja", priceMinor: 2500n, currency: "EUR", taxRateBp: 2100 })
      .returning({ id: products.id });
    const [b] = await migrator.db.insert(products).values({ tenantId: t.tenantId, name: "Modelo B", unit: "caja", priceMinor: 1000n, currency: "EUR" }).returning({ id: products.id });
    await migrator.db.insert(productVariants).values([
      { tenantId: t.tenantId, productId: b!.id, options: { color: "Rojo" }, optionKey: "color=rojo" },
      { tenantId: t.tenantId, productId: b!.id, options: { color: "Azul" }, optionKey: "color=azul" },
    ]);
    const outbound: unknown[] = [];
    const aiTurns: unknown[][] = [];
    const deps: OrderExtractionWorkerDeps = {
      db: app.db,
      cipher,
      fetch: llm.fetch,
      lookup: publicLookup,
      publisher: pub.publisher,
      outboundQueue: { add: async (...args: unknown[]) => (outbound.push(args), {}) } as never,
      aiQueue: { add: async (...args: unknown[]) => (aiTurns.push(args), {}) } as never,
      loadMedia: async () => ({ data: makePdf("PEDIDO 0042: 12 cajas modelo A y 6 modelo B"), mimeType: "application/pdf" }),
      pdfText: async (bytes) => (await parsePdf(bytes)).text,
    };
    const job = { tenantId: t.tenantId, conversationId: conv.conversationId, messageId: m!.id };
    return { t, deps, job, outbound, aiTurns, productA: a!.id, messageId: m!.id };
  }

  it("order voice note -> one reply (the order summary), catalog-priced draft, no AI turn; replay is a no-op", async () => {
    const s = await setup({ mime: "audio/ogg", transcript: "Mándame 12 cajas del modelo A y 6 del B" });
    const out = await processExtractOrder(s.deps, s.job, { attemptsMade: 0, maxAttempts: 5 });
    expect(out).toMatchObject({ outcome: "created", status: "needs_confirmation", replied: true });
    expect(s.outbound).toHaveLength(1);
    expect(s.aiTurns).toHaveLength(0);

    const [ext] = await migrator.db.select().from(orderExtractions).where(eq(orderExtractions.messageId, s.messageId));
    expect(ext!.items.map((i) => i.status)).toEqual(["matched", "dudoso"]);
    const [q] = await migrator.db.select().from(quotes).where(eq(quotes.id, ext!.quoteId!));
    expect(q).toMatchObject({ status: "draft", createdByType: "ai", currency: "EUR", subtotalMinor: 30_000n, totalMinor: 36_300n });
    const items = await migrator.db.select().from(quoteItems).where(eq(quoteItems.quoteId, q!.id));
    expect(items).toEqual([expect.objectContaining({ productId: s.productA, unitPriceMinor: 2500n, quantityMilli: 12_000n })]);
    const usage = await migrator.db.select().from(usageLedger).where(and(eq(usageLedger.tenantId, s.t.tenantId), eq(usageLedger.kind, "llm_tokens")));
    expect(usage.some((u) => (u.meta as { purpose?: string }).purpose === "order_extraction")).toBe(true);

    expect(await processExtractOrder(s.deps, s.job, { attemptsMade: 0, maxAttempts: 5 })).toMatchObject({ outcome: "skipped", reason: "already-processed", aiTurn: false });
    expect(s.outbound).toHaveLength(1);
    expect(s.aiTurns).toHaveLength(0);
  });

  it("chit-chat voice note -> no extraction reply, the normal AI turn is scheduled once", async () => {
    const s = await setup({ mime: "audio/ogg", transcript: "hola, ¿a qué hora abren mañana?" });
    expect(await processExtractOrder(s.deps, s.job, { attemptsMade: 0, maxAttempts: 5 })).toMatchObject({ outcome: "skipped", reason: "not_an_order", aiTurn: true });
    expect(s.outbound).toHaveLength(0);
    expect(s.aiTurns).toEqual([[AI_TURN_JOB, { tenantId: s.t.tenantId, conversationId: s.job.conversationId, triggerMessageId: s.messageId }, expect.objectContaining({ jobId: aiTurnJobId(s.messageId) })]]);
  });

  it("image with a provider without vision -> handoff, zero auto replies, no AI turn", async () => {
    const s = await setup({ mime: "image/jpeg" });
    expect(await processExtractOrder(s.deps, s.job, { attemptsMade: 0, maxAttempts: 5 })).toMatchObject({ outcome: "created", status: "skipped", replied: false });
    const [ext] = await migrator.db.select().from(orderExtractions).where(eq(orderExtractions.messageId, s.messageId));
    expect(ext).toMatchObject({ status: "skipped", reason: "provider_without_vision" });
    expect(s.outbound).toHaveLength(0);
    expect(s.aiTurns).toHaveLength(0);
  });

  it("PDF order -> parsed with @crmwsp/knowledge, extracted into a draft, one reply", async () => {
    const s = await setup({ mime: "application/pdf" });
    const out = await processExtractOrder(s.deps, s.job, { attemptsMade: 0, maxAttempts: 5 });
    expect(out).toMatchObject({ outcome: "created", replied: true });
    expect(out.outcome === "created" && out.quoteId).toBeTruthy();
    expect(s.outbound).toHaveLength(1);
    expect(s.aiTurns).toHaveLength(0);
  });
});
