import {
  buildOrderImageMessages,
  buildOrderTextMessages,
  orderExtractionResponseFormat,
  sanitizeOrderOutput,
  type LLMProvider,
  type OrderExtractionOutput,
  type OrderSourceKind,
  type TokenUsage,
} from "@crmwsp/ai";
import type { OrderExtractionStatus, StoredOrderLine } from "@crmwsp/db";
import {
  buildOrderConfirmationReply,
  draftLines,
  looksLikeOrder,
  matchOrderLines,
  type CatalogCandidate,
  type DraftLine,
  type MatchedLine,
} from "@crmwsp/domain";
import type { DownloadedMedia } from "@crmwsp/whatsapp";
import type { InboxEvent, Logger } from "../processors.js";

/**
 * F4 "Pedidos desde voz, foto o PDF". A customer's voice note (transcript), photo of a list or PDF
 * is read by the tenant's LLM (BYOK) into line items, matched against the catalog, and turned into
 * a DRAFT quote with catalog prices only. Nothing here creates an order or a payment, and the draft
 * is sent only after a human submits it through the existing quote approval flow.
 */

export const MAX_ORDER_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ORDER_PDF_BYTES = 15 * 1024 * 1024;

export interface ConversationState {
  aiMode: string;
  assignedUserId: string | null;
  status: string;
  lastInboundAt: Date | null;
}

export interface ExtractionContext {
  source: OrderSourceKind;
  attachmentId: string | null;
  externalMediaId: string | null;
  mimeType: string | null;
  transcript: string | null;
  /** A `pending_payment` order exists: images are receipts (T8), not orders. */
  hasPendingPaymentOrder: boolean;
  /** Tenant policy override denies `create_quote_draft`: extract, but build no quote. */
  quoteDraftDenied: boolean;
}

export interface LlmAccess {
  provider: Pick<LLMProvider, "chat">;
  model: string;
  visionModel: string;
  visionSupported: boolean;
  budgetExceeded: boolean;
}

export interface NewExtraction {
  source: OrderSourceKind;
  attachmentId: string | null;
  status: OrderExtractionStatus;
  reason: string | null;
  items: StoredOrderLine[];
  notes: string | null;
  currency: string | null;
  model: string | null;
}

export interface OrderTxStore {
  extractionExists(): Promise<boolean>;
  insertExtraction(row: NewExtraction): Promise<string | null>;
  loadCatalog(): Promise<CatalogCandidate[]>;
  createQuoteDraft(lines: DraftLine[], currency: string): Promise<{ id: string; number: string }>;
  linkQuote(extractionId: string, quoteId: string): Promise<void>;
  recordUsage(u: { model: string; usage: TokenUsage; extractionId: string | null; source: OrderSourceKind }): Promise<void>;
  audit(entityId: string, diff: Record<string, unknown>): Promise<void>;
  notify(n: { kind: "approval_requested" | "handoff"; title: string; body: string; entityId: string }): Promise<void>;
  conversationState(): Promise<ConversationState | undefined>;
  insertReply(body: string, clientMessageId: string): Promise<string | null>;
}

export interface OrderFlowPorts {
  /** Reads the trigger message context; undefined when the message has no usable media. */
  context(): Promise<ExtractionContext | undefined>;
  llm(): Promise<LlmAccess | undefined>;
  loadMedia?: (() => Promise<DownloadedMedia>) | undefined;
  /** PDF text extraction (e.g. `parsePdf` of @crmwsp/knowledge); absent = PDFs are handed off. */
  pdfText?: ((bytes: Uint8Array) => Promise<string>) | undefined;
  inTx<T>(fn: (s: OrderTxStore) => Promise<T>): Promise<T>;
  canAutoReply(conv: ConversationState): boolean;
  replyClientMessageId: string;
  conversationId: string;
  /** True on the last attempt: a missing transcript is then final instead of retried. */
  lastAttempt: boolean;
  logger: Logger;
}

export class TranscriptPendingError extends Error {
  constructor() {
    super("voice note transcript not available yet");
    this.name = "TranscriptPendingError";
  }
}

export type OrderFlowResult =
  | { outcome: "skipped"; reason: string; events: InboxEvent[] }
  | {
      outcome: "created";
      extractionId: string;
      status: OrderExtractionStatus;
      quoteId: string | null;
      replied: boolean;
      enqueueMessageId?: string;
      events: InboxEvent[];
    };

const skipped = (reason: string): OrderFlowResult => ({ outcome: "skipped", reason, events: [] });

type Read =
  | { kind: "messages"; messages: ReturnType<typeof buildOrderTextMessages>; model: string }
  | { kind: "skip"; reason: string }
  | { kind: "handoff"; reason: string };

async function prepareInput(ctx: ExtractionContext, llm: LlmAccess, p: OrderFlowPorts): Promise<Read> {
  if (ctx.source === "audio") {
    const text = ctx.transcript?.trim() ?? "";
    if (text === "") {
      if (!p.lastAttempt) throw new TranscriptPendingError();
      return { kind: "skip", reason: "no_transcript" };
    }
    if (!looksLikeOrder(text)) return { kind: "skip", reason: "not_an_order" };
    return { kind: "messages", messages: buildOrderTextMessages("audio", text), model: llm.model };
  }
  if (ctx.source === "image" && ctx.hasPendingPaymentOrder) return { kind: "skip", reason: "receipt_flow" };
  if (ctx.source === "image" && !llm.visionSupported) return { kind: "handoff", reason: "provider_without_vision" };
  if (ctx.source === "pdf" && !p.pdfText) return { kind: "handoff", reason: "pdf_parser_unavailable" };
  if (!p.loadMedia || !ctx.externalMediaId) return { kind: "handoff", reason: "media_unavailable" };
  let media: DownloadedMedia;
  try {
    media = await p.loadMedia();
  } catch (err) {
    p.logger.warn(`order media download failed (${err instanceof Error ? err.name : "unknown"})`);
    return { kind: "handoff", reason: "media_unavailable" };
  }
  if (media.data.byteLength === 0) return { kind: "handoff", reason: "empty_media" };
  if (ctx.source === "image") {
    if (media.data.byteLength > MAX_ORDER_IMAGE_BYTES) return { kind: "handoff", reason: "image_too_large" };
    const mimeType = media.mimeType || ctx.mimeType || "image/jpeg";
    if (!mimeType.startsWith("image/")) return { kind: "handoff", reason: "not_an_image" };
    return { kind: "messages", messages: buildOrderImageMessages({ mimeType, data: media.data }), model: llm.visionModel };
  }
  if (media.data.byteLength > MAX_ORDER_PDF_BYTES) return { kind: "handoff", reason: "pdf_too_large" };
  let text: string;
  try {
    text = (await p.pdfText!(media.data)).trim();
  } catch (err) {
    p.logger.warn(`order pdf parse failed (${err instanceof Error ? err.name : "unknown"})`);
    return { kind: "handoff", reason: "pdf_invalid" };
  }
  if (text === "") return { kind: "handoff", reason: "pdf_without_text" };
  return { kind: "messages", messages: buildOrderTextMessages("pdf", text), model: llm.model };
}

/** JSON-safe stored form of a matched line. */
export function toStoredLine(l: MatchedLine): StoredOrderLine {
  return {
    rawText: l.input.rawText,
    quantity: l.input.quantity,
    unit: l.input.unit,
    productGuess: l.input.productGuess,
    status: l.status,
    reason: l.reason,
    confidence: l.confidence,
    editedBy: null,
    match: l.match ? { ...l.match, unitPriceMinor: l.match.unitPriceMinor.toString() } : null,
    quantityMilli: l.quantityMilli === null ? null : l.quantityMilli.toString(),
    alternatives: l.alternatives,
  };
}

const SOURCE_LABEL: Record<OrderSourceKind, string> = { audio: "audio", image: "foto", pdf: "PDF" };

export async function handleOrderExtraction(p: OrderFlowPorts): Promise<OrderFlowResult> {
  if (await p.inTx((s) => s.extractionExists())) return skipped("already-processed");
  const ctx = await p.context();
  if (!ctx) return skipped("no_media");
  if (ctx.source === "image" && ctx.hasPendingPaymentOrder) return skipped("receipt_flow");
  const llm = await p.llm();
  if (!llm) return skipped("no_llm_connection");
  if (llm.budgetExceeded) return skipped("budget_exceeded");

  const read = await prepareInput(ctx, llm, p);
  if (read.kind === "skip") return skipped(read.reason);
  if (read.kind === "handoff") {
    // The customer sent an image/PDF we cannot read: a human takes it (no LLM spend).
    return p.inTx(async (s) => {
      const id = await s.insertExtraction({
        source: ctx.source,
        attachmentId: ctx.attachmentId,
        status: "skipped",
        reason: read.reason,
        items: [],
        notes: null,
        currency: null,
        model: null,
      });
      if (!id) return skipped("already-processed");
      await s.notify({
        kind: "handoff",
        title: `Posible pedido por ${SOURCE_LABEL[ctx.source]} sin leer`,
        body: `La IA no pudo leer el ${SOURCE_LABEL[ctx.source]} (${read.reason}). Revisalo en la conversación.`,
        entityId: id,
      });
      return { outcome: "created", extractionId: id, status: "skipped", quoteId: null, replied: false, events: [] } satisfies OrderFlowResult;
    });
  }

  // LLM call outside any transaction.
  let out: OrderExtractionOutput | undefined;
  let usage: TokenUsage | undefined;
  let failure: string | null = null;
  try {
    const res = await llm.provider.chat({
      model: read.model,
      messages: read.messages,
      responseFormat: orderExtractionResponseFormat,
      temperature: 0,
      maxTokens: 1500,
    });
    usage = res.usage;
    out = res.parsed ? sanitizeOrderOutput(res.parsed) : undefined;
    if (!out) failure = "invalid_output";
  } catch (err) {
    p.logger.warn(`order extraction failed (${err instanceof Error ? err.name : "unknown"})`);
    failure = "provider_error";
  }

  return p.inTx(async (s) => {
    const items = out?.items ?? [];
    if (failure !== null || items.length === 0) {
      const id = await s.insertExtraction({
        source: ctx.source,
        attachmentId: ctx.attachmentId,
        status: failure !== null ? "failed" : "skipped",
        reason: failure ?? "not_an_order",
        items: [],
        notes: null,
        currency: null,
        model: read.model,
      });
      if (usage) await s.recordUsage({ model: read.model, usage, extractionId: id, source: ctx.source });
      return skipped(failure ?? "not_an_order");
    }

    const catalog = await s.loadCatalog();
    const matched = matchOrderLines(items, catalog);
    const dudosos = matched.lines.filter((l) => l.status === "dudoso").length;
    const status: OrderExtractionStatus = dudosos > 0 ? "needs_confirmation" : "ready";
    const id = await s.insertExtraction({
      source: ctx.source,
      attachmentId: ctx.attachmentId,
      status,
      reason: null,
      items: matched.lines.map(toStoredLine),
      notes: out?.notes ?? null,
      currency: matched.currency,
      model: read.model,
    });
    if (!id) return skipped("already-processed");
    if (usage) await s.recordUsage({ model: read.model, usage, extractionId: id, source: ctx.source });

    const draft = draftLines(matched.lines);
    let quote: { id: string; number: string } | null = null;
    if (!ctx.quoteDraftDenied && draft.lines.length > 0 && matched.currency) {
      quote = await s.createQuoteDraft(draft.lines, matched.currency);
      await s.linkQuote(id, quote.id);
    }
    await s.audit(id, {
      source: ctx.source,
      lines: matched.lines.length,
      matched: matched.lines.length - dudosos,
      dudosos,
      quoteId: quote?.id ?? null,
      quoteDraftDenied: ctx.quoteDraftDenied,
    });
    await s.notify({
      kind: "approval_requested",
      title: `Pedido detectado (${SOURCE_LABEL[ctx.source]})`,
      body: `${matched.lines.length} artículo(s), ${dudosos} por confirmar.${quote ? ` Borrador de presupuesto ${quote.number}: revisalo antes de enviarlo.` : ""}`,
      entityId: id,
    });

    const events: InboxEvent[] = [];
    let enqueueMessageId: string | undefined;
    const conv = await s.conversationState();
    if (conv && p.canAutoReply(conv)) {
      const msgId = await s.insertReply(buildOrderConfirmationReply(matched.lines), p.replyClientMessageId);
      if (msgId) {
        enqueueMessageId = msgId;
        events.push({ type: "message.created", conversationId: p.conversationId, messageId: msgId });
      }
    }
    return {
      outcome: "created",
      extractionId: id,
      status,
      quoteId: quote?.id ?? null,
      replied: enqueueMessageId !== undefined,
      ...(enqueueMessageId ? { enqueueMessageId } : {}),
      events,
    } satisfies OrderFlowResult;
  });
}
