import { randomUUID } from "node:crypto";
import { attachments, messages, orderExtractions, productVariants, products, quoteItems, quotes, usageLedger, type DbHandle } from "@crmwsp/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_URL, MIGRATOR_URL, createDb, dropTenants, hasEnv } from "../../__tests__/helpers.js";
import { capturePublisher, makeCipher, mockLlm, publicLookup, seedAiTenant, seedConversation } from "../../__tests__/ai-helpers.js";
import { processExtractOrder } from "../worker.js";

const MODEL_JSON = JSON.stringify({
  items: [
    { rawText: "12 cajas del modelo A", quantity: 12, unit: "cajas", productGuess: "modelo A" },
    { rawText: "6 del B", quantity: 6, unit: null, productGuess: "modelo B" },
  ],
  notes: null,
});

describe.skipIf(!hasEnv)("extract-order with Postgres (mocked LLM)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const tenantIds: string[] = [];
  const cipher = makeCipher();
  const pub = capturePublisher();
  const llm = mockLlm(() => MODEL_JSON);
  const enqueued: unknown[] = [];

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

  it("voice note -> extraction row, catalog-priced quote draft, usage, reply; replay is a no-op", async () => {
    const t = await seedAiTenant(migrator, cipher);
    tenantIds.push(t.tenantId);
    const conv = await seedConversation(migrator, t, "auto");
    const [m] = await migrator.db
      .insert(messages)
      .values({ tenantId: t.tenantId, conversationId: conv.conversationId, direction: "inbound", type: "audio", externalId: `wamid-${randomUUID()}`, status: "received", author: "contact" })
      .returning({ id: messages.id });
    await migrator.db.insert(attachments).values({
      tenantId: t.tenantId,
      messageId: m!.id,
      mimeType: "audio/ogg",
      externalMediaId: "media-1",
      transcript: "Mándame 12 cajas del modelo A y 6 del B",
    });
    const [a] = await migrator.db
      .insert(products)
      .values({ tenantId: t.tenantId, name: "Modelo A", unit: "caja", priceMinor: 2500n, currency: "EUR", taxRateBp: 2100 })
      .returning({ id: products.id });
    const [b] = await migrator.db
      .insert(products)
      .values({ tenantId: t.tenantId, name: "Modelo B", unit: "caja", priceMinor: 1000n, currency: "EUR" })
      .returning({ id: products.id });
    await migrator.db.insert(productVariants).values([
      { tenantId: t.tenantId, productId: b!.id, options: { color: "Rojo" }, optionKey: "color=rojo" },
      { tenantId: t.tenantId, productId: b!.id, options: { color: "Azul" }, optionKey: "color=azul" },
    ]);

    const deps = {
      db: app.db,
      cipher,
      fetch: llm.fetch,
      lookup: publicLookup,
      publisher: pub.publisher,
      outboundQueue: { add: async (...args: unknown[]) => (enqueued.push(args), {}) } as never,
    };
    const job = { tenantId: t.tenantId, conversationId: conv.conversationId, messageId: m!.id };
    const out = await processExtractOrder(deps, job, { attemptsMade: 0, maxAttempts: 5 });
    expect(out).toMatchObject({ outcome: "created", status: "needs_confirmation", replied: true });

    const [ext] = await migrator.db.select().from(orderExtractions).where(eq(orderExtractions.messageId, m!.id));
    expect(ext!.items.map((i) => i.status)).toEqual(["matched", "dudoso"]);
    expect(ext!.items[1]!.alternatives.slice(0, 2).map((x) => x.label).sort()).toEqual(["Modelo B (Azul)", "Modelo B (Rojo)"]);
    const [q] = await migrator.db.select().from(quotes).where(eq(quotes.id, ext!.quoteId!));
    expect(q).toMatchObject({ status: "draft", createdByType: "ai", currency: "EUR", subtotalMinor: 30_000n, totalMinor: 36_300n });
    const items = await migrator.db.select().from(quoteItems).where(eq(quoteItems.quoteId, q!.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productId: a!.id, unitPriceMinor: 2500n, quantityMilli: 12_000n });
    const usage = await migrator.db
      .select()
      .from(usageLedger)
      .where(and(eq(usageLedger.tenantId, t.tenantId), eq(usageLedger.kind, "llm_tokens")));
    expect(usage.some((u) => (u.meta as { purpose?: string }).purpose === "order_extraction")).toBe(true);
    expect(enqueued).toHaveLength(1);

    const again = await processExtractOrder(deps, job, { attemptsMade: 0, maxAttempts: 5 });
    expect(again).toMatchObject({ outcome: "skipped", reason: "already-processed" });
  });
});
