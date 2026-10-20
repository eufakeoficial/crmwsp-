import { createHash } from "node:crypto";
import { ORDER_EXTRACTION_PROMPT_VERSION, estimateCost } from "@crmwsp/ai";
import {
  agentConfigs,
  attachments,
  auditEvents,
  computeLineTotal,
  conversations,
  llmConnections,
  messages,
  orderExtractions,
  orders,
  productVariants,
  products,
  quoteItems,
  quotes,
  usageLedger,
  withTenant,
  type LlmConnection,
  type Transaction,
} from "@crmwsp/db";
import { sumLines, type CatalogCandidate } from "@crmwsp/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import { insertNotification } from "../notifications/notify.js";
import { readBudget } from "../ai/budget.js";
import { buildProvider, type AiDeps } from "../ai/common.js";
import { DEFAULT_TRANSCRIPTION_MODEL, transcribeAttachment, type TranscribeOutcome } from "../ai/transcribe.js";
import { aiMayAutoReply, sessionWindowOpen } from "../ai/turn.js";
import { orderSourceOf, type ExtractOrderJobData } from "./queue.js";
import type { ExtractionContext, LlmAccess, OrderFlowPorts, OrderTxStore } from "./flow.js";

export const QUOTE_VALID_DAYS = 15;
/** Catalog rows considered for matching (active products x active variants). */
export const MAX_CATALOG_CANDIDATES = 5_000;

/** Deterministic uuid (client_message_id is a uuid) so a replayed job inserts no second reply. */
export function orderReplyClientMessageId(messageId: string): string {
  const h = createHash("sha256").update(`order-extraction-reply:${messageId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function variantLabel(name: string, options: Record<string, string>): string {
  const vals = Object.values(options);
  return vals.length > 0 ? `${name} (${vals.join(" / ")})` : name;
}

/** Active catalog as matching candidates: one per non-default variant, else one per product. */
export async function loadCatalogCandidates(tx: Transaction): Promise<CatalogCandidate[]> {
  const rows = await tx
    .select({ p: products, v: productVariants })
    .from(products)
    .leftJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isActive, true)))
    .where(and(eq(products.isActive, true), eq(products.status, "active")))
    .orderBy(asc(products.name), asc(productVariants.position))
    .limit(MAX_CATALOG_CANDIDATES);
  const withOptions = new Set(rows.filter((r) => r.v && r.v.optionKey !== "").map((r) => r.p.id));
  const out: CatalogCandidate[] = [];
  const seenProduct = new Set<string>();
  for (const { p, v } of rows) {
    const common = { productId: p.id, productVersion: p.version, unit: p.unit, currency: p.currency, taxRateBp: p.taxRateBp };
    if (withOptions.has(p.id)) {
      if (!v || v.optionKey === "") continue;
      out.push({
        ...common,
        variantId: v.id,
        label: variantLabel(p.name, v.options),
        searchText: [p.name, ...Object.values(v.options), p.category ?? "", ...p.tags].join(" "),
        sku: v.sku ?? p.sku,
        priceMinor: v.priceMinor ?? p.priceMinor,
      });
    } else if (!seenProduct.has(p.id)) {
      seenProduct.add(p.id);
      out.push({
        ...common,
        variantId: null,
        label: p.name,
        searchText: [p.category ?? "", ...p.tags].join(" "),
        sku: p.sku ?? v?.sku ?? null,
        priceMinor: v?.priceMinor ?? p.priceMinor,
      });
    }
  }
  return out;
}

function transcriptionModelFor(conn: LlmConnection): string {
  const configured = (conn.capabilities as { transcriptionModel?: unknown }).transcriptionModel;
  return typeof configured === "string" && configured.trim() !== "" ? configured.trim() : DEFAULT_TRANSCRIPTION_MODEL;
}

/**
 * Stores the transcript once (first writer wins) and books its cost only for the writer that
 * stored it, so the AI turn that runs afterwards reuses it without a second charge.
 */
async function persistTranscript(
  tx: Transaction,
  job: ExtractOrderJobData,
  attachmentId: string,
  t: Extract<TranscribeOutcome, { status: "transcribed" }>,
): Promise<void> {
  const updated = await tx
    .update(attachments)
    .set({ transcript: t.text })
    .where(and(eq(attachments.id, attachmentId), sql`${attachments.transcript} is null`))
    .returning({ id: attachments.id });
  if (updated.length === 0) return;
  await tx.insert(usageLedger).values({
    tenantId: job.tenantId,
    kind: "transcription_seconds",
    quantity: String(t.seconds),
    unit: "seconds",
    costMinor: BigInt(t.costMinor),
    currency: "USD",
    refType: "conversation",
    refId: job.conversationId,
    meta: {
      model: t.model,
      attachmentId,
      messageId: job.messageId,
      purpose: "order_extraction",
      durationEstimated: t.durationEstimated,
      verified: t.verified,
      priceKnown: t.priceKnown,
      unit: "usd_microcents",
    },
  });
}

function visionModelFor(conn: LlmConnection): string {
  const configured = conn.capabilities.visionModel;
  return typeof configured === "string" && configured.trim() !== "" ? configured.trim() : conn.modelCheap;
}

export function createPgOrderStore(tx: Transaction, tenantId: string, job: ExtractOrderJobData, now: Date): OrderTxStore {
  const { conversationId, messageId } = job;
  return {
    async existingExtraction() {
      const [r] = await tx
        .select({ status: orderExtractions.status, reason: orderExtractions.reason })
        .from(orderExtractions)
        .where(eq(orderExtractions.messageId, messageId))
        .limit(1);
      return r;
    },
    async insertExtraction(r) {
      const rows = await tx
        .insert(orderExtractions)
        .values({ tenantId, conversationId, messageId, ...r })
        .onConflictDoNothing({ target: [orderExtractions.tenantId, orderExtractions.messageId] })
        .returning({ id: orderExtractions.id });
      return rows[0]?.id ?? null;
    },
    loadCatalog: () => loadCatalogCandidates(tx),
    async createQuoteDraft(lines, currency) {
      const [conv] = await tx.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, conversationId));
      if (!conv) throw new Error("conversation not found");
      const numRows = await tx.execute<{ n: string }>(sql`select public.next_document_number('quote'::text, ${now.getUTCFullYear()}::int) as n`);
      const number = Array.from(numRows)[0]?.n;
      if (!number) throw new Error("next_document_number returned nothing");
      const totals = sumLines(lines.map((l) => l.breakdown));
      const [q] = await tx
        .insert(quotes)
        .values({
          tenantId,
          number,
          contactId: conv.contactId,
          conversationId,
          status: "draft",
          currency,
          subtotalMinor: totals.subtotal,
          discountMinor: totals.discount,
          taxMinor: totals.tax,
          totalMinor: totals.total,
          validUntil: new Date(now.getTime() + QUOTE_VALID_DAYS * 24 * 3600 * 1000),
          notes: "Borrador generado a partir de un pedido detectado por la IA. Revisar antes de enviar.",
          createdByType: "ai",
        })
        .returning({ id: quotes.id });
      if (!q) throw new Error("quote insert returned no row");
      await tx.insert(quoteItems).values(
        lines.map((l, position) => ({
          tenantId,
          quoteId: q.id,
          position,
          productId: l.productId,
          productVersion: l.productVersion,
          variantId: l.variantId,
          description: l.description,
          quantityMilli: l.quantityMilli,
          unit: l.unit,
          unitPriceMinor: l.unitPriceMinor,
          discountBp: 0,
          taxRateBp: l.taxRateBp,
          lineTotalMinor: computeLineTotal(l.quantityMilli, l.unitPriceMinor, 0, l.taxRateBp),
        })),
      );
      return { id: q.id, number };
    },
    async linkQuote(extractionId, quoteId) {
      await tx.update(orderExtractions).set({ quoteId, updatedAt: now }).where(eq(orderExtractions.id, extractionId));
    },
    async recordUsage({ model, usage, extractionId, source }) {
      const cost = estimateCost(model, usage);
      await tx.insert(usageLedger).values({
        tenantId,
        kind: "llm_tokens",
        quantity: String(usage.inputTokens + usage.outputTokens),
        unit: "tokens",
        costMinor: BigInt(cost.costMinor),
        currency: cost.currency,
        refType: "conversation",
        refId: conversationId,
        meta: {
          model,
          purpose: "order_extraction",
          source,
          orderExtractionId: extractionId,
          messageId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          promptVersion: ORDER_EXTRACTION_PROMPT_VERSION,
          verified: cost.verified,
          priceKnown: cost.known,
          unit: "usd_microcents",
        },
      });
    },
    async audit(entityId, diff) {
      await tx.insert(auditEvents).values({ tenantId, actorType: "ai", entity: "order_extraction", entityId, action: "order_extraction.created", diff });
    },
    async notify(n) {
      await insertNotification(tx, tenantId, {
        ...n,
        entity: "order_extraction",
        conversationId,
        dedupeKey: `order_extraction:${n.entityId}`,
      });
    },
    async conversationState() {
      const [c] = await tx
        .select({
          aiMode: conversations.aiMode,
          assignedUserId: conversations.assignedUserId,
          status: conversations.status,
          lastInboundAt: conversations.lastInboundAt,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      return c;
    },
    async insertReply(body, clientMessageId) {
      const [msg] = await tx
        .insert(messages)
        .values({ tenantId, conversationId, direction: "outbound", type: "text", body, status: "queued", author: "ai", clientMessageId })
        .onConflictDoNothing({
          target: [messages.tenantId, messages.clientMessageId],
          where: sql`${messages.clientMessageId} is not null`,
        })
        .returning({ id: messages.id });
      if (!msg) return null;
      await tx.update(conversations).set({ lastMessageAt: now, updatedAt: now }).where(eq(conversations.id, conversationId));
      return msg.id;
    },
  };
}

/** Reads the trigger message's media and the tenant policy (RLS-scoped). */
export async function loadExtractionContext(tx: Transaction, job: ExtractOrderJobData): Promise<ExtractionContext | undefined> {
  const [row] = await tx
    .select({
      contactId: conversations.contactId,
      direction: messages.direction,
      attachmentId: attachments.id,
      externalMediaId: attachments.externalMediaId,
      mimeType: attachments.mimeType,
      transcript: attachments.transcript,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(attachments, eq(attachments.messageId, messages.id))
    .where(and(eq(messages.id, job.messageId), eq(messages.conversationId, job.conversationId)))
    .limit(1);
  if (!row || row.direction !== "inbound") return undefined;
  const source = orderSourceOf(row.mimeType);
  if (!source) return undefined;
  const [pending] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.contactId, row.contactId), eq(orders.status, "pending_payment")))
    .limit(1);
  const [cfg] = await tx.select({ policies: agentConfigs.policies }).from(agentConfigs).where(eq(agentConfigs.isActive, true)).limit(1);
  const override = (cfg?.policies as Record<string, unknown> | undefined)?.["create_quote_draft"];
  return {
    source,
    attachmentId: row.attachmentId,
    externalMediaId: row.externalMediaId,
    mimeType: row.mimeType,
    transcript: row.transcript,
    hasPendingPaymentOrder: pending !== undefined,
    quoteDraftDenied: override === "deny",
  };
}

export interface OrderExtractionDeps extends Pick<AiDeps, "db" | "cipher" | "fetch" | "lookup" | "loadMedia" | "logger" | "now"> {
  /** PDF text extraction; wire `parsePdf` of @crmwsp/knowledge here. Absent = PDFs are handed off. */
  pdfText?: (bytes: Uint8Array) => Promise<string>;
}

export function pgOrderFlowPorts(
  deps: OrderExtractionDeps,
  job: ExtractOrderJobData,
  opts: { logger: NonNullable<AiDeps["logger"]> },
): OrderFlowPorts {
  const now = deps.now?.() ?? new Date();
  let ctxCache: ExtractionContext | undefined;
  let connCache: { conn: LlmConnection; provider: ReturnType<typeof buildProvider> } | undefined;
  return {
    conversationId: job.conversationId,
    replyClientMessageId: orderReplyClientMessageId(job.messageId),
    logger: opts.logger,
    ...(deps.pdfText ? { pdfText: deps.pdfText } : {}),
    async context() {
      ctxCache = await withTenant(deps.db, job.tenantId, (tx) => loadExtractionContext(tx, job));
      return ctxCache;
    },
    async llm(): Promise<LlmAccess | undefined> {
      const conn = await withTenant(deps.db, job.tenantId, async (tx) => {
        const [c] = await tx.select().from(llmConnections).where(eq(llmConnections.isActive, true)).limit(1);
        if (!c || !c.lastTestOk) return undefined;
        return { c, budget: await readBudget(tx, c) };
      });
      if (!conn) return undefined;
      connCache = { conn: conn.c, provider: buildProvider(deps as AiDeps, job.tenantId, conn.c) };
      return {
        provider: connCache.provider,
        model: conn.c.modelCheap,
        visionModel: visionModelFor(conn.c),
        visionSupported: conn.c.capabilities.vision === true,
        budgetExceeded: conn.budget.exceeded,
      };
    },
    loadMedia: deps.loadMedia
      ? () => {
          if (!ctxCache?.externalMediaId) return Promise.reject(new Error("media_unavailable"));
          return deps.loadMedia!({
            tenantId: job.tenantId,
            conversationId: job.conversationId,
            externalMediaId: ctxCache.externalMediaId,
            mimeType: ctxCache.mimeType,
          });
        }
      : undefined,
    async transcribe() {
      const att = ctxCache;
      if (!connCache || !att?.attachmentId) return null;
      const { conn, provider } = connCache;
      const outcome = await transcribeAttachment(
        { id: att.attachmentId, externalMediaId: att.externalMediaId, mimeType: att.mimeType, transcript: att.transcript },
        {
          tenantId: job.tenantId,
          conversationId: job.conversationId,
          provider,
          supported: conn.capabilities.transcription === true,
          model: transcriptionModelFor(conn),
          loadMedia: deps.loadMedia,
          logger: opts.logger,
        },
      );
      if (outcome.status === "cached") return outcome.text;
      if (outcome.status !== "transcribed") return null;
      await withTenant(deps.db, job.tenantId, (tx) => persistTranscript(tx, job, att.attachmentId as string, outcome));
      return outcome.text;
    },
    inTx: (fn) => withTenant(deps.db, job.tenantId, (tx) => fn(createPgOrderStore(tx, job.tenantId, job, now))),
    canAutoReply: (conv) => aiMayAutoReply(conv) && sessionWindowOpen(conv.lastInboundAt, now),
  };
}
