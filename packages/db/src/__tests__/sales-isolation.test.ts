import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { computeLineTotal } from "../line-total.js";
import { runMigrations } from "../migrate.js";
import {
  aiActions,
  channelConnections,
  consents,
  contacts,
  conversations,
  documentSequences,
  followUps,
  knowledgeChunks,
  knowledgeSources,
  memberships,
  messageTemplates,
  messages,
  opportunities,
  opportunityStageHistory,
  orderItems,
  orders,
  pipelineStages,
  pipelines,
  productMedia,
  productVariants,
  products,
  quoteItems,
  quotes,
  stockMovements,
  tasks,
  tenants,
  users,
} from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

type PgCause = { code?: string; message?: string };
const pgCause = (err: unknown): PgCause | undefined =>
  (err as Error & { cause?: PgCause } | undefined)?.cause ?? (err as PgCause | undefined);
const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );
const must = <T>(row: T | undefined): T => {
  if (row === undefined) throw new Error("seed failed");
  return row;
};

interface Seed {
  tenant: string;
  user: string;
  conn: string;
  contact: string;
  conversation: string;
  message: string;
  chunk: string;
  action: string;
  pipeline: string;
  otherPipeline: string;
  stage: string;
  stage2: string;
  otherStage: string;
  opportunity: string;
  history: string;
  task: string;
  product: string;
  product2: string;
  variant: string;
  variant2: string;
  media: string;
  quote: string;
  quoteItem: string;
  order: string;
  orderItem: string;
  movement: string;
  consent: string;
  template: string;
  followUp: string;
}

describe.skipIf(!hasDb)("sales, catalog, orders, consents and follow-ups RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let pool: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const extraTenants: string[] = [];
  const extraUsers: string[] = [];
  let A: Seed;
  let B: Seed;

  async function seed(label: string): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const t = must(
        (await tx.insert(tenants).values({ slug: `sal-${label}-${suffix}`, name: `Tenant ${label}` }).returning({ id: tenants.id }))[0],
      ).id;
      const user = must(
        (await tx.insert(users).values({ email: `sal-${label}-${suffix}@example.test`, name: label }).returning({ id: users.id }))[0],
      ).id;
      await tx.insert(memberships).values({ tenantId: t, userId: user, role: "owner" });
      const conn = must(
        (await tx
          .insert(channelConnections)
          .values({ tenantId: t, provider: "gupshup", phoneE164: "+34600000001", webhookToken: `tok-${label}-${randomUUID()}`, status: "active" })
          .returning({ id: channelConnections.id }))[0],
      ).id;
      const contact = must(
        (await tx.insert(contacts).values({ tenantId: t, phoneE164: "+34611111111", name: "Cli" }).returning({ id: contacts.id }))[0],
      ).id;
      const conversation = must(
        (await tx.insert(conversations).values({ tenantId: t, contactId: contact, channelConnectionId: conn }).returning({ id: conversations.id }))[0],
      ).id;
      const message = must(
        (await tx
          .insert(messages)
          .values({ tenantId: t, conversationId: conversation, direction: "outbound", type: "text", body: "hola", status: "sent", author: "user" })
          .returning({ id: messages.id }))[0],
      ).id;
      const source = must(
        (await tx.insert(knowledgeSources).values({ tenantId: t, kind: "csv", title: "Catalog", status: "ready" }).returning({ id: knowledgeSources.id }))[0],
      ).id;
      const chunk = must(
        (await tx
          .insert(knowledgeChunks)
          .values({ tenantId: t, sourceId: source, sourceVersion: 1, ordinal: 0, content: "camiseta 20 EUR" })
          .returning({ id: knowledgeChunks.id }))[0],
      ).id;
      const action = must(
        (await tx.insert(aiActions).values({ tenantId: t, type: "create_quote", decision: "approve" }).returning({ id: aiActions.id }))[0],
      ).id;
      const pipeline = must(
        (await tx.insert(pipelines).values({ tenantId: t, name: "Ventas", isDefault: true }).returning({ id: pipelines.id }))[0],
      ).id;
      const otherPipeline = must(
        (await tx.insert(pipelines).values({ tenantId: t, name: "Otro" }).returning({ id: pipelines.id }))[0],
      ).id;
      const st = await tx
        .insert(pipelineStages)
        .values([
          { tenantId: t, pipelineId: pipeline, key: "new", name: "Nuevo", position: 1, kind: "open" },
          { tenantId: t, pipelineId: pipeline, key: "won", name: "Ganado", position: 2, kind: "won" },
          { tenantId: t, pipelineId: otherPipeline, key: "new", name: "Nuevo", position: 1, kind: "open" },
        ])
        .returning({ id: pipelineStages.id });
      const stage = must(st[0]).id;
      const stage2 = must(st[1]).id;
      const otherStage = must(st[2]).id;
      const opportunity = must(
        (await tx
          .insert(opportunities)
          .values({ tenantId: t, contactId: contact, conversationId: conversation, pipelineId: pipeline, stageId: stage, title: "Op", valueMinor: 1000n, currency: "EUR", ownerUserId: user })
          .returning({ id: opportunities.id }))[0],
      ).id;
      const history = must(
        (await tx
          .insert(opportunityStageHistory)
          .values({ tenantId: t, opportunityId: opportunity, toStageId: stage, changedByType: "system" })
          .returning({ id: opportunityStageHistory.id }))[0],
      ).id;
      const task = must(
        (await tx.insert(tasks).values({ tenantId: t, title: "Llamar", opportunityId: opportunity, conversationId: conversation, aiActionId: action }).returning({ id: tasks.id }))[0],
      ).id;
      const pr = await tx
        .insert(products)
        .values([
          { tenantId: t, sku: "CAM", name: "Camiseta", priceMinor: 2000n, currency: "EUR", knowledgeChunkId: chunk, priceSource: "knowledge" },
          { tenantId: t, sku: "GOR", name: "Gorra", priceMinor: 1500n, currency: "EUR" },
        ])
        .returning({ id: products.id });
      const product = must(pr[0]).id;
      const product2 = must(pr[1]).id;
      const vr = await tx
        .insert(productVariants)
        .values([
          { tenantId: t, productId: product, sku: "CAM-M", options: { talla: "M" }, optionKey: "talla=m", stockOnHand: 5 },
          { tenantId: t, productId: product2, optionKey: "", stockOnHand: 1 },
        ])
        .returning({ id: productVariants.id });
      const variant = must(vr[0]).id;
      const variant2 = must(vr[1]).id;
      const media = must(
        (await tx.insert(productMedia).values({ tenantId: t, productId: product, variantId: variant, kind: "image", storageKey: "k/img.jpg" }).returning({ id: productMedia.id }))[0],
      ).id;
      const quote = must(
        (await tx
          .insert(quotes)
          .values({ tenantId: t, number: `PRE-2026-${label}`, opportunityId: opportunity, contactId: contact, conversationId: conversation, currency: "EUR", validUntil: new Date(Date.now() + 864e5), approvalActionId: action, createdByType: "ai" })
          .returning({ id: quotes.id }))[0],
      ).id;
      const quoteItem = must(
        (await tx
          .insert(quoteItems)
          .values({ tenantId: t, quoteId: quote, position: 1, productId: product, productVersion: 1, knowledgeChunkId: chunk, description: "Camiseta", quantityMilli: 1000n, unitPriceMinor: 2000n, lineTotalMinor: 2000n })
          .returning({ id: quoteItems.id }))[0],
      ).id;
      const order = must(
        (await tx
          .insert(orders)
          .values({ tenantId: t, number: `PED-2026-${label}`, contactId: contact, conversationId: conversation, opportunityId: opportunity, quoteId: quote, currency: "EUR", fulfillment: "shipping", createdByType: "user" })
          .returning({ id: orders.id }))[0],
      ).id;
      const orderItem = must(
        (await tx
          .insert(orderItems)
          .values({ tenantId: t, orderId: order, variantId: variant, productId: product, description: "Camiseta M", options: { talla: "M" }, quantity: 1, unitPriceMinor: 2000n, lineTotalMinor: 2000n })
          .returning({ id: orderItems.id }))[0],
      ).id;
      const movement = must(
        (await tx.insert(stockMovements).values({ tenantId: t, variantId: variant, delta: 5, reason: "manual_adjust", createdBy: user }).returning({ id: stockMovements.id }))[0],
      ).id;
      const consent = must(
        (await tx
          .insert(consents)
          .values({ tenantId: t, contactId: contact, kind: "follow_up", status: "granted", evidence: { source: "whatsapp", messageId: message }, grantedAt: new Date() })
          .returning({ id: consents.id }))[0],
      ).id;
      const template = must(
        (await tx
          .insert(messageTemplates)
          .values({ tenantId: t, channelConnectionId: conn, name: "seguimiento", language: "es", category: "utility", status: "approved", body: "Hola {{1}}", variables: ["name"] })
          .returning({ id: messageTemplates.id }))[0],
      ).id;
      const followUp = must(
        (await tx
          .insert(followUps)
          .values({ tenantId: t, opportunityId: opportunity, conversationId: conversation, quoteId: quote, reason: "Presupuesto sin respuesta en 3 dias", scheduledAt: new Date(), requiresTemplate: true, templateId: template, sentMessageId: message })
          .returning({ id: followUps.id }))[0],
      ).id;
      await tx.insert(documentSequences).values({ tenantId: t, kind: "quote", year: 2026, lastValue: 1 });
      await tx.update(messages).set({ aiActionId: action }).where(eq(messages.id, message));
      return {
        tenant: t, user, conn, contact, conversation, message, chunk, action, pipeline, otherPipeline, stage, stage2, otherStage,
        opportunity, history, task, product, product2, variant, variant2, media, quote, quoteItem, order, orderItem, movement,
        consent, template, followUp,
      };
    });
  }

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    pool = createDb(APP_URL as string, { max: 20 });
    A = await seed("a");
    B = await seed("b");
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [A?.tenant, B?.tenant, ...extraTenants].filter((x): x is string => Boolean(x));
      const uids = [A?.user, B?.user, ...extraUsers].filter((x): x is string => Boolean(x));
      // stock_movements/history/etc. cascade from tenants.
      if (ids.length) await migrator.db.delete(tenants).where(inArray(tenants.id, ids));
      if (uids.length) await migrator.db.delete(users).where(inArray(users.id, uids));
      await migrator.close();
    }
    if (app) await app.close();
    if (pool) await pool.close();
  });

  const tables = [
    { name: "pipelines", table: pipelines, key: "pipeline", appendOnly: false },
    { name: "pipeline_stages", table: pipelineStages, key: "stage", appendOnly: false },
    { name: "opportunities", table: opportunities, key: "opportunity", appendOnly: false },
    { name: "opportunity_stage_history", table: opportunityStageHistory, key: "history", appendOnly: true },
    { name: "tasks", table: tasks, key: "task", appendOnly: false },
    { name: "products", table: products, key: "product", appendOnly: false },
    { name: "product_variants", table: productVariants, key: "variant", appendOnly: false },
    { name: "product_media", table: productMedia, key: "media", appendOnly: false },
    { name: "quotes", table: quotes, key: "quote", appendOnly: false },
    { name: "quote_items", table: quoteItems, key: "quoteItem", appendOnly: false },
    { name: "orders", table: orders, key: "order", appendOnly: false },
    { name: "order_items", table: orderItems, key: "orderItem", appendOnly: false },
    { name: "stock_movements", table: stockMovements, key: "movement", appendOnly: true },
    { name: "consents", table: consents, key: "consent", appendOnly: false },
    { name: "message_templates", table: messageTemplates, key: "template", appendOnly: false },
    { name: "follow_ups", table: followUps, key: "followUp", appendOnly: false },
  ] as const;

  for (const { name, table, key, appendOnly } of tables) {
    it(`${name}: tenant A only sees its rows and cannot modify or delete B's`, async () => {
      const rows = await withTenant(app.db, A.tenant, (tx) =>
        tx.select({ id: table.id, tenantId: table.tenantId }).from(table),
      );
      expect(rows.map((r) => r.id)).toContain(A[key]);
      expect(rows.every((r) => r.tenantId === A.tenant)).toBe(true);
      expect(await app.db.select({ id: table.id }).from(table)).toHaveLength(0);

      if (appendOnly) {
        const upd = await settle(
          withTenant(app.db, A.tenant, (tx) => tx.update(table).set({ tenantId: A.tenant }).where(eq(table.id, A[key]))),
        );
        expect(pgCause(upd)?.code).toBe("42501");
        const del = await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(table).where(eq(table.id, A[key]))));
        expect(pgCause(del)?.code).toBe("42501");
      } else {
        const upd = await withTenant(app.db, A.tenant, (tx) =>
          tx.update(table).set({ tenantId: A.tenant }).where(eq(table.id, B[key])).returning({ id: table.id }),
        );
        expect(upd).toHaveLength(0);
        const del = await withTenant(app.db, A.tenant, (tx) =>
          tx.delete(table).where(eq(table.id, B[key])).returning({ id: table.id }),
        );
        expect(del).toHaveLength(0);
      }
      // Writing a row for another tenant is rejected by WITH CHECK.
      const other = await withTenant(migrator.db, B.tenant, (tx) => tx.select({ id: table.id }).from(table).where(eq(table.id, B[key])));
      expect(other).toHaveLength(1);
    });
  }

  it("document_sequences: isolated per tenant", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) => tx.select().from(documentSequences));
    expect(rows.every((r) => r.tenantId === A.tenant)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(await app.db.select().from(documentSequences)).toHaveLength(0);
  });

  it("app role cannot insert a row for another tenant (WITH CHECK)", async () => {
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(pipelines).values({ tenantId: B.tenant, name: "x" }),
      ),
    );
    expect(pgCause(err)?.code).toBe("42501");
  });

  describe("composite FKs reject cross-tenant links (23503)", () => {
    const validUntil = new Date(Date.now() + 864e5);
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["pipeline_stages -> pipelines", () => withTenant(app.db, A.tenant, (tx) => tx.insert(pipelineStages).values({ tenantId: A.tenant, pipelineId: B.pipeline, key: "z", name: "Z", position: 9 }))],
      ["opportunities -> contacts", () => withTenant(app.db, A.tenant, (tx) => tx.insert(opportunities).values({ tenantId: A.tenant, contactId: B.contact, pipelineId: A.pipeline, stageId: A.stage, title: "x", currency: "EUR" }))],
      ["opportunities -> conversations", () => withTenant(app.db, A.tenant, (tx) => tx.insert(opportunities).values({ tenantId: A.tenant, contactId: A.contact, conversationId: B.conversation, pipelineId: A.pipeline, stageId: A.stage, title: "x", currency: "EUR" }))],
      ["opportunities -> pipeline+stage of B", () => withTenant(app.db, A.tenant, (tx) => tx.insert(opportunities).values({ tenantId: A.tenant, contactId: A.contact, pipelineId: B.pipeline, stageId: B.stage, title: "x", currency: "EUR" }))],
      ["opportunities: stage of another pipeline (same tenant)", () => withTenant(app.db, A.tenant, (tx) => tx.insert(opportunities).values({ tenantId: A.tenant, contactId: A.contact, pipelineId: A.pipeline, stageId: A.otherStage, title: "x", currency: "EUR" }))],
      ["opportunities: moving to a stage of another pipeline", () => withTenant(app.db, A.tenant, (tx) => tx.update(opportunities).set({ stageId: A.otherStage }).where(eq(opportunities.id, A.opportunity)))],
      ["stage_history -> opportunities", () => withTenant(app.db, A.tenant, (tx) => tx.insert(opportunityStageHistory).values({ tenantId: A.tenant, opportunityId: B.opportunity, toStageId: A.stage, changedByType: "user" }))],
      ["stage_history -> to_stage", () => withTenant(app.db, A.tenant, (tx) => tx.insert(opportunityStageHistory).values({ tenantId: A.tenant, opportunityId: A.opportunity, toStageId: B.stage, changedByType: "user" }))],
      ["stage_history -> from_stage", () => withTenant(app.db, A.tenant, (tx) => tx.insert(opportunityStageHistory).values({ tenantId: A.tenant, opportunityId: A.opportunity, fromStageId: B.stage, toStageId: A.stage, changedByType: "user" }))],
      ["tasks -> opportunities", () => withTenant(app.db, A.tenant, (tx) => tx.insert(tasks).values({ tenantId: A.tenant, title: "x", opportunityId: B.opportunity }))],
      ["tasks -> conversations", () => withTenant(app.db, A.tenant, (tx) => tx.insert(tasks).values({ tenantId: A.tenant, title: "x", conversationId: B.conversation }))],
      ["tasks -> ai_actions", () => withTenant(app.db, A.tenant, (tx) => tx.insert(tasks).values({ tenantId: A.tenant, title: "x", aiActionId: B.action }))],
      ["products -> knowledge_chunks", () => withTenant(app.db, A.tenant, (tx) => tx.insert(products).values({ tenantId: A.tenant, name: "x", priceMinor: 1n, currency: "EUR", knowledgeChunkId: B.chunk }))],
      ["product_variants -> products", () => withTenant(app.db, A.tenant, (tx) => tx.insert(productVariants).values({ tenantId: A.tenant, productId: B.product, optionKey: "q" }))],
      ["product_media -> products", () => withTenant(app.db, A.tenant, (tx) => tx.insert(productMedia).values({ tenantId: A.tenant, productId: B.product, kind: "image", storageKey: "k" }))],
      ["product_media: variant of another product (same tenant)", () => withTenant(app.db, A.tenant, (tx) => tx.insert(productMedia).values({ tenantId: A.tenant, productId: A.product, variantId: A.variant2, kind: "image", storageKey: "k" }))],
      ["quotes -> contacts", () => withTenant(app.db, A.tenant, (tx) => tx.insert(quotes).values({ tenantId: A.tenant, number: "X-1", contactId: B.contact, currency: "EUR", validUntil, createdByType: "user" }))],
      ["quotes -> opportunities", () => withTenant(app.db, A.tenant, (tx) => tx.insert(quotes).values({ tenantId: A.tenant, number: "X-2", contactId: A.contact, opportunityId: B.opportunity, currency: "EUR", validUntil, createdByType: "user" }))],
      ["quotes -> conversations", () => withTenant(app.db, A.tenant, (tx) => tx.insert(quotes).values({ tenantId: A.tenant, number: "X-3", contactId: A.contact, conversationId: B.conversation, currency: "EUR", validUntil, createdByType: "user" }))],
      ["quotes -> ai_actions", () => withTenant(app.db, A.tenant, (tx) => tx.insert(quotes).values({ tenantId: A.tenant, number: "X-4", contactId: A.contact, approvalActionId: B.action, currency: "EUR", validUntil, createdByType: "user" }))],
      ["quote_items -> quotes", () => withTenant(app.db, A.tenant, (tx) => tx.insert(quoteItems).values({ tenantId: A.tenant, quoteId: B.quote, position: 5, description: "x", quantityMilli: 1000n, unitPriceMinor: 1n, lineTotalMinor: 1n }))],
      ["quote_items -> products", () => withTenant(app.db, A.tenant, (tx) => tx.insert(quoteItems).values({ tenantId: A.tenant, quoteId: A.quote, position: 6, productId: B.product, description: "x", quantityMilli: 1000n, unitPriceMinor: 1n, lineTotalMinor: 1n }))],
      ["quote_items -> variants (0016)", () => withTenant(app.db, A.tenant, (tx) => tx.insert(quoteItems).values({ tenantId: A.tenant, quoteId: A.quote, position: 8, variantId: B.variant, description: "x", quantityMilli: 1000n, unitPriceMinor: 1n, lineTotalMinor: 1n }))],
      ["quote_items -> knowledge_chunks", () => withTenant(app.db, A.tenant, (tx) => tx.insert(quoteItems).values({ tenantId: A.tenant, quoteId: A.quote, position: 7, knowledgeChunkId: B.chunk, description: "x", quantityMilli: 1000n, unitPriceMinor: 1n, lineTotalMinor: 1n }))],
      ["orders -> contacts", () => withTenant(app.db, A.tenant, (tx) => tx.insert(orders).values({ tenantId: A.tenant, number: "O-1", contactId: B.contact, currency: "EUR", fulfillment: "pickup", createdByType: "user" }))],
      ["orders -> quotes", () => withTenant(app.db, A.tenant, (tx) => tx.insert(orders).values({ tenantId: A.tenant, number: "O-2", contactId: A.contact, quoteId: B.quote, currency: "EUR", fulfillment: "pickup", createdByType: "user" }))],
      ["orders -> opportunities", () => withTenant(app.db, A.tenant, (tx) => tx.insert(orders).values({ tenantId: A.tenant, number: "O-3", contactId: A.contact, opportunityId: B.opportunity, currency: "EUR", fulfillment: "pickup", createdByType: "user" }))],
      ["orders -> conversations", () => withTenant(app.db, A.tenant, (tx) => tx.insert(orders).values({ tenantId: A.tenant, number: "O-4", contactId: A.contact, conversationId: B.conversation, currency: "EUR", fulfillment: "pickup", createdByType: "user" }))],
      ["order_items -> orders", () => withTenant(app.db, A.tenant, (tx) => tx.insert(orderItems).values({ tenantId: A.tenant, orderId: B.order, description: "x", quantity: 1, unitPriceMinor: 1n, lineTotalMinor: 1n }))],
      ["order_items -> variants", () => withTenant(app.db, A.tenant, (tx) => tx.insert(orderItems).values({ tenantId: A.tenant, orderId: A.order, variantId: B.variant, description: "x", quantity: 1, unitPriceMinor: 1n, lineTotalMinor: 1n }))],
      ["order_items -> products", () => withTenant(app.db, A.tenant, (tx) => tx.insert(orderItems).values({ tenantId: A.tenant, orderId: A.order, productId: B.product, description: "x", quantity: 1, unitPriceMinor: 1n, lineTotalMinor: 1n }))],
      ["stock_movements -> variants", () => withTenant(app.db, A.tenant, (tx) => tx.insert(stockMovements).values({ tenantId: A.tenant, variantId: B.variant, delta: 1, reason: "manual_adjust" }))],
      ["consents -> contacts", () => withTenant(app.db, A.tenant, (tx) => tx.insert(consents).values({ tenantId: A.tenant, contactId: B.contact, kind: "marketing", status: "granted" }))],
      ["message_templates -> channel_connections", () => withTenant(app.db, A.tenant, (tx) => tx.insert(messageTemplates).values({ tenantId: A.tenant, channelConnectionId: B.conn, name: "n", language: "es", category: "utility", body: "b" }))],
      ["follow_ups -> conversations", () => withTenant(app.db, A.tenant, (tx) => tx.insert(followUps).values({ tenantId: A.tenant, conversationId: B.conversation, reason: "r", scheduledAt: new Date() }))],
      ["follow_ups -> opportunities", () => withTenant(app.db, A.tenant, (tx) => tx.insert(followUps).values({ tenantId: A.tenant, conversationId: A.conversation, opportunityId: B.opportunity, reason: "r", scheduledAt: new Date() }))],
      ["follow_ups -> quotes", () => withTenant(app.db, A.tenant, (tx) => tx.insert(followUps).values({ tenantId: A.tenant, conversationId: A.conversation, quoteId: B.quote, reason: "r", scheduledAt: new Date() }))],
      ["follow_ups -> message_templates", () => withTenant(app.db, A.tenant, (tx) => tx.insert(followUps).values({ tenantId: A.tenant, conversationId: A.conversation, templateId: B.template, reason: "r", scheduledAt: new Date() }))],
      ["follow_ups -> messages", () => withTenant(app.db, A.tenant, (tx) => tx.insert(followUps).values({ tenantId: A.tenant, conversationId: A.conversation, sentMessageId: B.message, reason: "r", scheduledAt: new Date() }))],
      ["messages.ai_action_id -> ai_actions", () => withTenant(app.db, A.tenant, (tx) => tx.update(messages).set({ aiActionId: B.action }).where(eq(messages.id, A.message)))],
    ];
    for (const [label, run] of cases) {
      it(label, async () => {
        expect(pgCause(await settle(run()))?.code).toBe("23503");
      });
    }
  });

  describe("constraints", () => {
    const code = async (fn: () => Promise<unknown>): Promise<string | undefined> => pgCause(await settle(fn()))?.code;

    it("only one default pipeline per tenant", async () => {
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(pipelines).values({ tenantId: A.tenant, name: "d2", isDefault: true })))).toBe("23505");
    });

    it("stage key and position are unique per pipeline; positions can be swapped (deferrable)", async () => {
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(pipelineStages).values({ tenantId: A.tenant, pipelineId: A.pipeline, key: "new", name: "dup", position: 9 })))).toBe("23505");
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(pipelineStages).values({ tenantId: A.tenant, pipelineId: A.pipeline, key: "dup", name: "dup", position: 1 })))).toBe("23505");
      // DEFERRABLE INITIALLY IMMEDIATE: checked at statement end, so a one-statement shift works...
      await withTenant(app.db, A.tenant, (tx) =>
        tx.update(pipelineStages).set({ position: sql`position + 10` }).where(eq(pipelineStages.pipelineId, A.pipeline)),
      );
      await withTenant(app.db, A.tenant, (tx) =>
        tx.update(pipelineStages).set({ position: sql`position - 10` }).where(eq(pipelineStages.pipelineId, A.pipeline)),
      );
      // ...a real clash fails, and a swap in two statements needs SET CONSTRAINTS ... DEFERRED.
      expect(
        await code(() => withTenant(app.db, A.tenant, (tx) => tx.update(pipelineStages).set({ position: 1 }).where(eq(pipelineStages.id, A.stage2)))),
      ).toBe("23505");
      await withTenant(app.db, A.tenant, async (tx) => {
        await tx.execute(sql`set constraints pipeline_stages_tenant_pipeline_position_unique deferred`);
        await tx.update(pipelineStages).set({ position: 2 }).where(eq(pipelineStages.id, A.stage));
        await tx.update(pipelineStages).set({ position: 1 }).where(eq(pipelineStages.id, A.stage2));
      });
      const rows = await withTenant(app.db, A.tenant, (tx) =>
        tx.select({ id: pipelineStages.id, position: pipelineStages.position }).from(pipelineStages).where(eq(pipelineStages.pipelineId, A.pipeline)),
      );
      expect(rows.find((r) => r.id === A.stage)?.position).toBe(2);
      expect(rows.find((r) => r.id === A.stage2)?.position).toBe(1);
    });

    it("consent is unique per (tenant, contact, kind)", async () => {
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(consents).values({ tenantId: A.tenant, contactId: A.contact, kind: "follow_up", status: "revoked" })))).toBe("23505");
      await withTenant(app.db, A.tenant, (tx) => tx.insert(consents).values({ tenantId: A.tenant, contactId: A.contact, kind: "marketing", status: "granted" }));
    });

    it("template is unique per (tenant, channel, name, language)", async () => {
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(messageTemplates).values({ tenantId: A.tenant, channelConnectionId: A.conn, name: "seguimiento", language: "es", category: "marketing", body: "x" })))).toBe("23505");
      await withTenant(app.db, A.tenant, (tx) => tx.insert(messageTemplates).values({ tenantId: A.tenant, channelConnectionId: A.conn, name: "seguimiento", language: "en", category: "utility", body: "x" }));
    });

    it("quote number is unique per tenant but reusable across tenants", async () => {
      const dup = await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(quotes).values({ tenantId: A.tenant, number: "PRE-2026-a", contactId: A.contact, currency: "EUR", validUntil: new Date(), createdByType: "user" })));
      expect(dup).toBe("23505");
    });

    it("quote_items.variant_id: deleting the variant sets only variant_id to null (0016)", async () => {
      const id = await withTenant(app.db, A.tenant, async (tx) => {
        const [v] = await tx.insert(productVariants).values({ tenantId: A.tenant, productId: A.product, optionKey: `tmp-${randomUUID()}` }).returning({ id: productVariants.id });
        const [it] = await tx
          .insert(quoteItems)
          .values({ tenantId: A.tenant, quoteId: A.quote, position: 30, variantId: must(v).id, description: "x", quantityMilli: 1000n, unitPriceMinor: 1n, lineTotalMinor: 1n })
          .returning({ id: quoteItems.id });
        await tx.delete(productVariants).where(eq(productVariants.id, must(v).id));
        return must(it).id;
      });
      const [row] = await withTenant(app.db, A.tenant, (tx) => tx.select().from(quoteItems).where(eq(quoteItems.id, id)));
      expect(row?.variantId).toBeNull();
      expect(row?.tenantId).toBe(A.tenant);
      await withTenant(app.db, A.tenant, (tx) => tx.delete(quoteItems).where(eq(quoteItems.id, id)));
    });

    it("quotes: accept_token_hash is indexed and unique per tenant (0016)", async () => {
      const rows = await migrator.sql<{ indexdef: string }[]>`select indexdef from pg_indexes where indexname = 'quotes_tenant_accept_token_hash_idx'`;
      expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX .*\(tenant_id, accept_token_hash\)/);
    });

    it("quotes: total_minor >= 0", async () => {
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.update(quotes).set({ totalMinor: -1n }).where(eq(quotes.id, A.quote))))).toBe("23514");
    });

    it("quote_items: quantity > 0 and price >= 0", async () => {
      const base = { tenantId: A.tenant, quoteId: A.quote, description: "x", lineTotalMinor: 0n };
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(quoteItems).values({ ...base, position: 20, quantityMilli: 0n, unitPriceMinor: 1n })))).toBe("23514");
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(quoteItems).values({ ...base, position: 21, quantityMilli: 1000n, unitPriceMinor: -1n })))).toBe("23514");
    });

    it("products: sku unique among active products only; negative price rejected", async () => {
      const mk = (sku: string, isActive: boolean) => () =>
        withTenant(app.db, A.tenant, (tx) => tx.insert(products).values({ tenantId: A.tenant, sku, name: "dup", priceMinor: 1n, currency: "EUR", isActive }));
      expect(await code(mk("CAM", true))).toBe("23505");
      expect(await code(mk("CAM", false))).toBeUndefined();
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(products).values({ tenantId: A.tenant, name: "neg", priceMinor: -1n, currency: "EUR" })))).toBe("23514");
      // the same sku in tenant B is fine
      expect(await code(() => withTenant(app.db, B.tenant, (tx) => tx.insert(products).values({ tenantId: B.tenant, sku: "NEW", name: "ok", priceMinor: 1n, currency: "EUR" })))).toBeUndefined();
    });

    it("products: slug unique per tenant when set", async () => {
      const mk = () => withTenant(app.db, A.tenant, (tx) => tx.insert(products).values({ tenantId: A.tenant, slug: "camiseta", name: "s", priceMinor: 1n, currency: "EUR" }));
      expect(await code(mk)).toBeUndefined();
      expect(await code(mk)).toBe("23505");
    });

    it("product_variants: stock >= 0, option_key unique per product, sku unique among active", async () => {
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.update(productVariants).set({ stockOnHand: -1 }).where(eq(productVariants.id, A.variant))))).toBe("23514");
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.update(productVariants).set({ stockReserved: -1 }).where(eq(productVariants.id, A.variant))))).toBe("23514");
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(productVariants).values({ tenantId: A.tenant, productId: A.product, optionKey: "talla=m" })))).toBe("23505");
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(productVariants).values({ tenantId: A.tenant, productId: A.product, optionKey: "talla=l", sku: "CAM-M" })))).toBe("23505");
    });

    it("product_media: storage_key or url according to kind", async () => {
      const ins = (v: Partial<typeof productMedia.$inferInsert>) => () =>
        withTenant(app.db, A.tenant, (tx) => tx.insert(productMedia).values({ tenantId: A.tenant, productId: A.product, kind: "image", ...v }));
      expect(await code(ins({ kind: "image" }))).toBe("23514");
      expect(await code(ins({ kind: "image", storageKey: "k", url: "https://x.test/a" }))).toBe("23514");
      expect(await code(ins({ kind: "video_link", storageKey: "k" }))).toBe("23514");
      expect(await code(ins({ kind: "document" }))).toBe("23514");
      expect(await code(ins({ kind: "video_link", url: "https://youtu.be/abc" }))).toBeUndefined();
      expect(await code(ins({ kind: "document", storageKey: "k/doc.pdf" }))).toBeUndefined();
    });

    it("orders: total >= 0, unique number; order_items: quantity > 0", async () => {
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.update(orders).set({ totalMinor: -1n }).where(eq(orders.id, A.order))))).toBe("23514");
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(orders).values({ tenantId: A.tenant, number: "PED-2026-a", contactId: A.contact, currency: "EUR", fulfillment: "pickup", createdByType: "user" })))).toBe("23505");
      expect(await code(() => withTenant(app.db, A.tenant, (tx) => tx.insert(orderItems).values({ tenantId: A.tenant, orderId: A.order, description: "x", quantity: 0, unitPriceMinor: 1n, lineTotalMinor: 0n })))).toBe("23514");
    });

    it("money columns are bigint (no floats)", async () => {
      const rows = await migrator.sql<{ table_name: string; column_name: string; data_type: string }[]>`
        select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and column_name like '%\_minor'
          and table_name in ('opportunities','products','product_variants','quotes','quote_items','orders','order_items')`;
      expect(rows.length).toBeGreaterThan(15);
      expect(rows.filter((r) => r.data_type !== "bigint")).toEqual([]);
    });
  });

  describe("document numbering", () => {
    it("20 parallel next_quote_number calls return 20 distinct consecutive numbers", async () => {
      const year = 2031;
      const nums = await Promise.all(
        Array.from({ length: 20 }, () =>
          withTenant(pool.db, A.tenant, async (tx) => {
            const r = await tx.execute<{ n: string }>(sql`select public.next_quote_number(${year}) as n`);
            return String(r[0]?.n);
          }),
        ),
      );
      expect(new Set(nums).size).toBe(20);
      const seqs = nums.map((n) => Number(n.split("-")[2])).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(nums[0]).toMatch(/^PRE-2031-\d{4}$/);
    });

    it("a rolled-back transaction does not burn a number; kinds and tenants are independent", async () => {
      const call = (tenant: string, kind: string, year: number) =>
        withTenant(app.db, tenant, async (tx) => String((await tx.execute<{ n: string }>(sql`select public.next_document_number(${kind}, ${year}) as n`))[0]?.n));
      await settle(
        withTenant(app.db, A.tenant, async (tx) => {
          await tx.execute(sql`select public.next_document_number('order', 2032)`);
          throw new Error("rollback");
        }),
      );
      expect(await call(A.tenant, "order", 2032)).toBe("PED-2032-0001");
      expect(await call(A.tenant, "order", 2032)).toBe("PED-2032-0002");
      expect(await call(B.tenant, "order", 2032)).toBe("PED-2032-0001");
      expect(await call(A.tenant, "quote", 2032)).toBe("PRE-2032-0001");
    });

    it("fails without tenant context and for invalid kinds", async () => {
      expect(pgCause(await settle(app.sql`select public.next_quote_number(2031)`))?.code).toBe("42501");
      expect(pgCause(await settle(withTenant(app.db, A.tenant, (tx) => tx.execute(sql`select public.next_document_number('x', 2031)`))))?.code).toBe("22023");
    });
  });

  describe("default pipeline seed", () => {
    it("seed_default_pipeline is idempotent and signup_tenant already seeds it", async () => {
      const t = must(
        (await migrator.db.insert(tenants).values({ slug: `sal-c-${suffix}`, name: "C" }).returning({ id: tenants.id }))[0],
      ).id;
      extraTenants.push(t);
      const seedIt = () =>
        withTenant(app.db, t, async (tx) => String((await tx.execute<{ id: string }>(sql`select public.seed_default_pipeline(${t}::uuid) as id`))[0]?.id));
      const first = await seedIt();
      expect(await seedIt()).toBe(first);
      const stages = await withTenant(app.db, t, (tx) =>
        tx.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, first)).orderBy(pipelineStages.position),
      );
      expect(stages.map((s) => s.key)).toEqual(["new", "contacted", "qualified", "quote_sent", "negotiation", "won", "lost"]);
      expect(stages.map((s) => s.kind)).toEqual(["open", "open", "open", "open", "open", "won", "lost"]);
      const ps = await withTenant(app.db, t, (tx) => tx.select().from(pipelines));
      expect(ps).toHaveLength(1);
      expect(ps[0]).toMatchObject({ name: "Ventas", isDefault: true });

      // Cannot seed another tenant's pipeline through the SECURITY DEFINER function.
      const bad = await settle(
        withTenant(app.db, A.tenant, (tx) => tx.execute(sql`select public.seed_default_pipeline(${t}::uuid)`)),
      );
      expect(pgCause(bad)?.code).toBe("42501");
      const noCtx = await settle(app.sql`select public.seed_default_pipeline(${t}::uuid)`);
      expect(pgCause(noCtx)?.code).toBe("42501");
      // The internal variant is not executable by the app role.
      const internal = await settle(app.sql`select public.seed_default_pipeline_internal(${t}::uuid)`);
      expect(pgCause(internal)?.code).toBe("42501");
    });

    it("a tenant created with signup_tenant already has the pipeline", async () => {
      const rows = await app.sql<{ user_id: string; tenant_id: string }[]>`
        select * from public.signup_tenant(${`sal-s-${suffix}@example.test`}, ${"Ana"}, ${"scrypt$dummy"}, ${"Signup"}, ${`sal-s-${suffix}`})`;
      const row = must(rows[0]);
      extraTenants.push(row.tenant_id);
      extraUsers.push(row.user_id);
      const stages = await withTenant(app.db, row.tenant_id, (tx) => tx.select().from(pipelineStages).orderBy(pipelineStages.position));
      expect(stages).toHaveLength(7);
      const ps = await withTenant(app.db, row.tenant_id, (tx) => tx.select().from(pipelines));
      expect(ps).toHaveLength(1);
      expect(ps[0]?.isDefault).toBe(true);
    });
  });

  describe("stock reservation", () => {
    async function mkVariant(tenant: string, stock: number, trackStock = true): Promise<{ variant: string; contact: string }> {
      return withTenant(app.db, tenant, async (tx) => {
        const p = must(
          (await tx.insert(products).values({ tenantId: tenant, name: `P-${randomUUID().slice(0, 6)}`, priceMinor: 100n, currency: "EUR", trackStock }).returning({ id: products.id }))[0],
        ).id;
        const v = must(
          (await tx.insert(productVariants).values({ tenantId: tenant, productId: p, stockOnHand: stock }).returning({ id: productVariants.id }))[0],
        ).id;
        const c = must((await tx.select({ id: contacts.id }).from(contacts).limit(1))[0]).id;
        return { variant: v, contact: c };
      });
    }
    async function mkOrder(tenant: string, contact: string, lines: Array<[string, number]>): Promise<string> {
      return withTenant(app.db, tenant, async (tx) => {
        const num = String((await tx.execute<{ n: string }>(sql`select public.next_document_number('order', 2040) as n`))[0]?.n);
        const o = must(
          (await tx.insert(orders).values({ tenantId: tenant, number: num, contactId: contact, currency: "EUR", fulfillment: "shipping", createdByType: "user" }).returning({ id: orders.id }))[0],
        ).id;
        await tx.insert(orderItems).values(
          lines.map(([variantId, quantity]) => ({ tenantId: tenant, orderId: o, variantId, description: "x", quantity, unitPriceMinor: 100n, lineTotalMinor: BigInt(quantity) * 100n })),
        );
        return o;
      });
    }
    const stock = (tenant: string, variant: string) =>
      withTenant(app.db, tenant, async (tx) =>
        must((await tx.select({ onHand: productVariants.stockOnHand, reserved: productVariants.stockReserved }).from(productVariants).where(eq(productVariants.id, variant)))[0]),
      );
    const stockState = (tenant: string, order: string) =>
      withTenant(app.db, tenant, async (tx) => must((await tx.select({ s: orders.stockState }).from(orders).where(eq(orders.id, order)))[0]).s);
    const run = (tenant: string, fn: "reserve_stock" | "commit_stock" | "release_stock", order: string) =>
      withTenant(app.db, tenant, (tx) => tx.execute(sql`select public.${sql.raw(fn)}(${order}::uuid)`));

    it("reserve, commit and release are idempotent by stock_state and log movements", async () => {
      const { variant, contact } = await mkVariant(A.tenant, 10);
      const o = await mkOrder(A.tenant, contact, [[variant, 3]]);
      await run(A.tenant, "reserve_stock", o);
      await run(A.tenant, "reserve_stock", o);
      expect(await stock(A.tenant, variant)).toEqual({ onHand: 10, reserved: 3 });
      expect(await stockState(A.tenant, o)).toBe("reserved");
      await run(A.tenant, "commit_stock", o);
      await run(A.tenant, "commit_stock", o);
      expect(await stock(A.tenant, variant)).toEqual({ onHand: 7, reserved: 0 });
      expect(await stockState(A.tenant, o)).toBe("committed");
      await run(A.tenant, "release_stock", o); // no-op once committed
      expect(await stock(A.tenant, variant)).toEqual({ onHand: 7, reserved: 0 });

      const o2 = await mkOrder(A.tenant, contact, [[variant, 2]]);
      await run(A.tenant, "reserve_stock", o2);
      await run(A.tenant, "release_stock", o2);
      await run(A.tenant, "release_stock", o2);
      expect(await stock(A.tenant, variant)).toEqual({ onHand: 7, reserved: 0 });
      expect(await stockState(A.tenant, o2)).toBe("released");
      const mv = await withTenant(app.db, A.tenant, (tx) =>
        tx.select({ reason: stockMovements.reason, delta: stockMovements.delta }).from(stockMovements).where(eq(stockMovements.variantId, variant)).orderBy(stockMovements.createdAt),
      );
      expect(mv.map((m) => `${m.reason}:${m.delta}`).sort()).toEqual(
        ["order_committed:-3", "order_released:-2", "order_reserved:2", "order_reserved:3"].sort(),
      );
    });

    it("insufficient stock raises insufficient_stock:<variant> and reserves nothing", async () => {
      const ok = await mkVariant(A.tenant, 5);
      const low = await mkVariant(A.tenant, 1);
      const o = await mkOrder(A.tenant, ok.contact, [[ok.variant, 2], [low.variant, 2]]);
      const err = await settle(run(A.tenant, "reserve_stock", o));
      expect(pgCause(err)?.code).toBe("P0001");
      expect(pgCause(err)?.message).toBe(`insufficient_stock:${low.variant}`);
      expect(await stock(A.tenant, ok.variant)).toEqual({ onHand: 5, reserved: 0 });
      expect(await stock(A.tenant, low.variant)).toEqual({ onHand: 1, reserved: 0 });
      expect(await stockState(A.tenant, o)).toBe("none");
    });

    it("variants of products without track_stock are not reserved", async () => {
      const { variant, contact } = await mkVariant(A.tenant, 0, false);
      const o = await mkOrder(A.tenant, contact, [[variant, 4]]);
      await run(A.tenant, "reserve_stock", o);
      expect(await stock(A.tenant, variant)).toEqual({ onHand: 0, reserved: 0 });
      expect(await stockState(A.tenant, o)).toBe("reserved");
    });

    it("the functions run under RLS: tenant B cannot reserve tenant A's order", async () => {
      const { variant, contact } = await mkVariant(A.tenant, 3);
      const o = await mkOrder(A.tenant, contact, [[variant, 1]]);
      const err = await settle(run(B.tenant, "reserve_stock", o));
      expect(pgCause(err)?.code).toBe("P0002");
      expect(await stock(A.tenant, variant)).toEqual({ onHand: 3, reserved: 0 });
    });

    it("20 concurrent 1-unit orders against stock 5 yield exactly 5 reservations", async () => {
      const { variant, contact } = await mkVariant(A.tenant, 5);
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) ids.push(await mkOrder(A.tenant, contact, [[variant, 1]]));
      const results = await Promise.all(ids.map((o) => settle(withTenant(pool.db, A.tenant, (tx) => tx.execute(sql`select public.reserve_stock(${o}::uuid)`)))));
      const ok = results.filter((r) => r === undefined).length;
      const failed = results.filter((r) => r !== undefined);
      expect(ok).toBe(5);
      expect(failed.every((e) => pgCause(e)?.message === `insufficient_stock:${variant}`)).toBe(true);
      expect(await stock(A.tenant, variant)).toEqual({ onHand: 5, reserved: 5 });
    });
  });

  describe("computeLineTotal", () => {
    it("applies discount then tax with half-even rounding", () => {
      expect(computeLineTotal(1000n, 2000n)).toBe(2000n);
      expect(computeLineTotal(1500n, 1000n)).toBe(1500n);
      expect(computeLineTotal(500n, 5n)).toBe(2n); // 2.5 -> 2 (half-even)
      expect(computeLineTotal(1500n, 5n)).toBe(8n); // 7.5 -> 8
      expect(computeLineTotal(2000n, 1000n, 1000, 2100)).toBe(2178n); // 2000 - 200 = 1800 + 378
      expect(computeLineTotal(1000n, 999n, 0, 2100)).toBe(1209n); // tax 209.79 -> 210
    });
    it("matches computeQuoteTotals from @crmwsp/pdf on a grid of inputs", async () => {
      // Test-only relative import: avoids a runtime dependency of the data package on pdfkit.
      const { computeQuoteTotals } = await import("../../../pdf/src/totals.js");
      for (const qty of [1, 1.5, 0.001, 3, 12.345]) {
        for (const price of [0, 5, 999, 123457]) {
          for (const disc of [0, 5, 12.5, 100]) {
            for (const tax of [0, 4, 10, 21]) {
              const pdf = computeQuoteTotals([{ description: "x", quantity: qty, unitPriceMinor: price, discountPercent: disc, taxRatePercent: tax }]);
              const mine = computeLineTotal(BigInt(Math.round(qty * 1000)), BigInt(price), Math.round(disc * 100), Math.round(tax * 100));
              expect(mine).toBe(BigInt(pdf.totalMinor));
            }
          }
        }
      }
    });
    it("rejects invalid input", () => {
      expect(() => computeLineTotal(0n, 1n)).toThrow(RangeError);
      expect(() => computeLineTotal(1000n, -1n)).toThrow(RangeError);
      expect(() => computeLineTotal(1000n, 1n, 10_001)).toThrow(RangeError);
      expect(() => computeLineTotal(1000n, 1n, 0, 1.5)).toThrow(RangeError);
    });
  });
});
