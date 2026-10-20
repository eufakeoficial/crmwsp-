import {
  applyDiscountActionSchema,
  createQuoteDraftActionSchema,
  createTaskActionSchema,
  moveStageActionSchema,
} from "@crmwsp/contracts";
import {
  computeLineTotal,
  contacts,
  conversations,
  isUuid,
  knowledgeChunks,
  opportunities,
  opportunityStageHistory,
  pipelineStages,
  pipelines,
  products,
  quoteItems,
  quotes,
  tasks,
  tenants,
  type Transaction,
} from "@crmwsp/db";
import { computeLineBreakdown, sumLines, type LineBreakdown } from "@crmwsp/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ActionOutcome, ActionRow } from "./actions.js";

const failed = (error: string, extra: Record<string, unknown> = {}): ActionOutcome => ({ status: "failed", result: { error, ...extra } });
const executed = (result: Record<string, unknown>): ActionOutcome => ({ status: "executed", result });

const QUOTE_VALID_DAYS = 15;
const MAX_QUANTITY_MILLI = 1_000_000;

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

async function loadConversation(tx: Transaction, id: string | null) {
  if (!id) return undefined;
  const [c] = await tx
    .select({ id: conversations.id, tenantId: conversations.tenantId, contactId: conversations.contactId, assignedUserId: conversations.assignedUserId })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return c;
}

/** Latest opportunity of the conversation that is still open (stage kind `open`). */
async function openOpportunity(tx: Transaction, conversationId: string) {
  const [o] = await tx
    .select({ id: opportunities.id, pipelineId: opportunities.pipelineId, stageId: opportunities.stageId })
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(opportunities.conversationId, conversationId), eq(pipelineStages.kind, "open")))
    .orderBy(desc(opportunities.createdAt), desc(opportunities.id))
    .limit(1);
  return o;
}

async function defaultPipelineId(tx: Transaction, tenantId: string): Promise<string | undefined> {
  const find = async () => (await tx.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.isDefault, true)).limit(1))[0]?.id;
  return (await find()) ?? (await tx.execute(sql`select public.seed_default_pipeline(${tenantId}::uuid)`), await find());
}

export async function createTask(tx: Transaction, row: ActionRow): Promise<ActionOutcome> {
  const parsed = createTaskActionSchema.safeParse(row.payload);
  if (!parsed.success) return failed("invalid_payload");
  const conv = await loadConversation(tx, row.conversationId);
  const opp = conv ? await openOpportunity(tx, conv.id) : undefined;
  const [t] = await tx
    .insert(tasks)
    .values({
      tenantId: conv?.tenantId ?? (await currentTenantId(tx)),
      title: parsed.data.title,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      assignedUserId: conv?.assignedUserId ?? null,
      origin: "ai",
      opportunityId: opp?.id ?? null,
      conversationId: conv?.id ?? null,
      aiActionId: row.id ?? null,
    })
    .returning({ id: tasks.id });
  return executed({ applied: true, taskId: t?.id });
}

async function currentTenantId(tx: Transaction): Promise<string> {
  const [t] = await tx.select({ id: tenants.id }).from(tenants).limit(1);
  if (!t) throw new Error("no tenant in context");
  return t.id;
}

export async function moveStage(tx: Transaction, row: ActionRow, now: Date): Promise<ActionOutcome> {
  const parsed = moveStageActionSchema.safeParse(row.payload);
  if (!parsed.success) return failed("invalid_payload");
  const conv = await loadConversation(tx, row.conversationId);
  if (!conv) return failed("conversation_not_found");
  const opp = await openOpportunity(tx, conv.id);
  const pipelineId = opp?.pipelineId ?? (await defaultPipelineId(tx, conv.tenantId));
  if (!pipelineId) return failed("pipeline_not_found");
  const stages = await tx.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pipelineId)).orderBy(asc(pipelineStages.position));
  const wanted = norm(parsed.data.stage);
  const stage = stages.find((s) => norm(s.key) === wanted) ?? stages.find((s) => norm(s.name) === wanted);
  if (!stage) return failed("stage_not_found", { stage: parsed.data.stage });

  const closed = {
    wonAt: stage.kind === "won" ? now : null,
    lostAt: stage.kind === "lost" ? now : null,
    lostReason: stage.kind === "lost" ? "Marcada como perdida por la IA" : null,
  };
  if (opp) {
    if (opp.stageId === stage.id) return executed({ applied: false, unchanged: true, opportunityId: opp.id });
    await tx
      .update(opportunities)
      .set({ stageId: stage.id, ...closed, lockVersion: sql`${opportunities.lockVersion} + 1`, updatedAt: now })
      .where(eq(opportunities.id, opp.id));
    await tx.insert(opportunityStageHistory).values({
      tenantId: conv.tenantId,
      opportunityId: opp.id,
      fromStageId: opp.stageId,
      toStageId: stage.id,
      changedByType: "ai",
      reason: closed.lostReason,
    });
    return executed({ applied: true, opportunityId: opp.id, created: false, stageId: stage.id });
  }

  const [contact] = await tx.select({ name: contacts.name, phone: contacts.phoneE164 }).from(contacts).where(eq(contacts.id, conv.contactId));
  const [tenant] = await tx.select({ currency: tenants.currency }).from(tenants).limit(1);
  const [created] = await tx
    .insert(opportunities)
    .values({
      tenantId: conv.tenantId,
      contactId: conv.contactId,
      conversationId: conv.id,
      pipelineId,
      stageId: stage.id,
      title: contact?.name ?? contact?.phone ?? "Oportunidad",
      currency: tenant?.currency ?? "EUR",
      ownerUserId: conv.assignedUserId,
      source: "ai",
      ...closed,
    })
    .returning({ id: opportunities.id });
  if (!created) throw new Error("opportunity insert returned no row");
  await tx.insert(opportunityStageHistory).values({
    tenantId: conv.tenantId,
    opportunityId: created.id,
    fromStageId: null,
    toStageId: stage.id,
    changedByType: "ai",
    reason: closed.lostReason,
  });
  return executed({ applied: true, opportunityId: created.id, created: true, stageId: stage.id });
}

/** An approval record created by POST /quotes/:id/submit (payload.quoteId): approving it approves that quote. */
async function approveQuoteRecord(tx: Transaction, quoteId: string, now: Date): Promise<ActionOutcome> {
  const rows = await tx
    .update(quotes)
    .set({ status: "approved", approvedAt: now, lockVersion: sql`${quotes.lockVersion} + 1`, updatedAt: now })
    .where(and(eq(quotes.id, quoteId), eq(quotes.status, "pending_approval")))
    .returning({ id: quotes.id });
  return executed({ applied: rows.length > 0, quoteId, approvalRecord: true });
}

export async function createQuoteDraft(tx: Transaction, row: ActionRow, now: Date): Promise<ActionOutcome> {
  const quoteRef = row.payload["quoteId"];
  if (isUuid(quoteRef)) return approveQuoteRecord(tx, quoteRef, now);

  const parsed = createQuoteDraftActionSchema.safeParse(row.payload);
  if (!parsed.success) return failed("invalid_payload");
  const conv = await loadConversation(tx, row.conversationId);
  if (!conv) return failed("conversation_not_found");

  const chunkIds = parsed.data.items.map((i) => i.chunkId).filter(isUuid);
  if (chunkIds.length !== parsed.data.items.length) return failed("chunk_not_found");
  const chunks = await tx.select({ id: knowledgeChunks.id, metadata: knowledgeChunks.metadata }).from(knowledgeChunks).where(inArray(knowledgeChunks.id, chunkIds));
  const linked = await tx.select().from(products).where(and(inArray(products.knowledgeChunkId, chunkIds), eq(products.isActive, true)));
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const productByChunk = new Map(linked.map((p) => [p.knowledgeChunkId as string, p]));

  let currency: string | undefined;
  const lines: Array<{
    chunkId: string;
    productId: string | null;
    productVersion: number | null;
    description: string;
    quantityMilli: bigint;
    unit: string;
    unitPriceMinor: bigint;
    taxRateBp: number;
    breakdown: LineBreakdown;
  }> = [];
  for (const item of parsed.data.items) {
    const chunk = chunkById.get(item.chunkId);
    if (!chunk) return failed("chunk_not_found", { chunkId: item.chunkId });
    const product = productByChunk.get(item.chunkId);
    const m = chunk.metadata;
    const price = product ? product.priceMinor : typeof m.price_minor === "number" && Number.isSafeInteger(m.price_minor) && m.price_minor >= 0 ? BigInt(m.price_minor) : undefined;
    const cur = product ? product.currency : typeof m.currency === "string" ? m.currency : undefined;
    if (price === undefined || !cur) return failed("no_price", { chunkId: item.chunkId });
    if (currency !== undefined && currency !== cur) return failed("mixed_currency");
    currency = cur;
    const quantityMilli = BigInt(Math.round(item.quantity * 1000));
    if (quantityMilli < 1n || quantityMilli > BigInt(MAX_QUANTITY_MILLI)) return failed("invalid_quantity", { chunkId: item.chunkId });
    const taxRateBp = product?.taxRateBp ?? 0;
    lines.push({
      chunkId: item.chunkId,
      productId: product?.id ?? null,
      productVersion: product?.version ?? null,
      description: product?.name ?? (typeof m["name"] === "string" ? m["name"] : "Artículo"),
      quantityMilli,
      unit: product?.unit ?? (typeof m["unit"] === "string" ? m["unit"] : "ud"),
      unitPriceMinor: price,
      taxRateBp,
      breakdown: computeLineBreakdown(quantityMilli, price, 0, taxRateBp),
    });
  }
  if (!currency) return failed("no_price");
  const totals = sumLines(lines.map((l) => l.breakdown));
  const opp = await openOpportunity(tx, conv.id);
  const year = now.getUTCFullYear();
  const numRows = await tx.execute<{ n: string }>(sql`select public.next_document_number('quote'::text, ${year}::int) as n`);
  const number = Array.from(numRows)[0]?.n;
  if (!number) throw new Error("next_document_number returned nothing");

  const [q] = await tx
    .insert(quotes)
    .values({
      tenantId: conv.tenantId,
      number,
      opportunityId: opp?.id ?? null,
      contactId: conv.contactId,
      conversationId: conv.id,
      status: "draft",
      currency,
      subtotalMinor: totals.subtotal,
      discountMinor: totals.discount,
      taxMinor: totals.tax,
      totalMinor: totals.total,
      validUntil: new Date(now.getTime() + QUOTE_VALID_DAYS * 24 * 3600 * 1000),
      createdByType: "ai",
    })
    .returning({ id: quotes.id });
  if (!q) throw new Error("quote insert returned no row");
  await tx.insert(quoteItems).values(
    lines.map((l, position) => ({
      tenantId: conv.tenantId,
      quoteId: q.id,
      position,
      productId: l.productId,
      productVersion: l.productVersion,
      knowledgeChunkId: l.chunkId,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      unitPriceMinor: l.unitPriceMinor,
      discountBp: 0,
      taxRateBp: l.taxRateBp,
      lineTotalMinor: computeLineTotal(l.quantityMilli, l.unitPriceMinor, 0, l.taxRateBp),
    })),
  );
  return executed({ applied: true, quoteId: q.id, number, totalMinor: Number(totals.total) });
}

/** Applies the percentage to every line of the conversation's latest DRAFT quote and recomputes the totals. */
export async function applyDiscount(tx: Transaction, row: ActionRow, now: Date): Promise<ActionOutcome> {
  const parsed = applyDiscountActionSchema.safeParse(row.payload);
  if (!parsed.success) return failed("invalid_payload");
  const discountBp = Math.round(parsed.data.percent * 100);
  if (!Number.isFinite(parsed.data.percent) || discountBp <= 0 || discountBp > 10_000) return failed("invalid_percent");
  if (!row.conversationId) return failed("conversation_not_found");
  const [quote] = await tx
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.conversationId, row.conversationId), eq(quotes.status, "draft")))
    .orderBy(desc(quotes.createdAt), desc(quotes.id))
    .limit(1)
    .for("update");
  if (!quote) return failed("no_draft_quote");
  const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteId, quote.id)).orderBy(asc(quoteItems.position));
  const breakdowns: LineBreakdown[] = [];
  for (const it of items) {
    const b = computeLineBreakdown(it.quantityMilli, it.unitPriceMinor, discountBp, it.taxRateBp);
    breakdowns.push(b);
    await tx
      .update(quoteItems)
      .set({ discountBp, lineTotalMinor: computeLineTotal(it.quantityMilli, it.unitPriceMinor, discountBp, it.taxRateBp) })
      .where(eq(quoteItems.id, it.id));
  }
  const totals = sumLines(breakdowns);
  await tx
    .update(quotes)
    .set({
      subtotalMinor: totals.subtotal,
      discountMinor: totals.discount,
      taxMinor: totals.tax,
      totalMinor: totals.total,
      lockVersion: sql`${quotes.lockVersion} + 1`,
      updatedAt: now,
    })
    .where(eq(quotes.id, quote.id));
  return executed({ applied: true, quoteId: quote.id, discountBp, totalMinor: Number(totals.total) });
}
