import {
  RECEIPT_PROMPT_VERSION,
  amountToMinor,
  buildReceiptMessages,
  estimateCost,
  normalizeCurrency,
  receiptResponseFormat,
  type LLMProvider,
  type TokenUsage,
} from "@crmwsp/ai";
import {
  conversations,
  messages,
  orders,
  paymentReviews,
  usageLedger,
  withTenant,
  type Database,
  type Transaction,
} from "@crmwsp/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { insertNotification, type NewNotification } from "../notifications/notify.js";
import type { InboxEvent, Logger } from "../processors.js";
import type { MediaLoader } from "./transcribe.js";

/**
 * Receipt review (T8). When a customer sends an image while one of their orders is
 * `pending_payment`, the AI may READ it (vision, BYOK) and a `payment_reviews` row is created for a
 * human. This module NEVER changes an order: no code path here updates `orders` or `payments`
 * (CLAUDE.md: `paid` only via webhook/reconciliation; humans approve through the audited manual
 * mark-paid path in the API).
 */

/** Vision inputs above this are not sent to the provider. */
export const MAX_RECEIPT_IMAGE_BYTES = 10 * 1024 * 1024;

export const RECEIPT_ACK_TEXT = (orderNumber: string): string =>
  `¡Gracias! Recibimos tu comprobante del pedido ${orderNumber}. Lo estamos verificando y te confirmaremos en cuanto el equipo lo revise.`;

export interface PendingOrderRef {
  id: string;
  number: string;
  totalMinor: bigint;
  currency: string;
}

export interface ReceiptImage {
  attachmentId: string | null;
  externalMediaId: string | null;
  mimeType: string | null;
  order: PendingOrderRef;
}

export type VisionOutcome =
  | {
      status: "extracted";
      amountMinor: bigint | null;
      currency: string | null;
      date: string | null;
      reference: string | null;
      confidence: number;
      isReceipt: boolean;
      model: string;
      usage: TokenUsage;
    }
  | { status: "unsupported"; reason: string }
  | { status: "failed"; reason: string; model?: string; usage?: TokenUsage };

export interface ExtractPorts {
  tenantId: string;
  conversationId: string;
  provider: Pick<LLMProvider, "chat">;
  /** capabilities.vision of the tenant connection. */
  supported: boolean;
  model: string;
  loadMedia: MediaLoader | undefined;
  logger: Logger;
}

/** Latest `pending_payment` order of the contact (RLS-scoped), if any. */
export async function findPendingPaymentOrder(tx: Transaction, contactId: string): Promise<PendingOrderRef | undefined> {
  const [o] = await tx
    .select({ id: orders.id, number: orders.number, totalMinor: orders.totalMinor, currency: orders.currency })
    .from(orders)
    .where(and(eq(orders.contactId, contactId), eq(orders.status, "pending_payment")))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  return o ?? undefined;
}

/** Reads the receipt with the BYOK vision model. Never throws; logs only error classes. */
export async function extractReceipt(img: ReceiptImage, p: ExtractPorts): Promise<VisionOutcome> {
  if (!p.supported) return { status: "unsupported", reason: "provider_without_vision" };
  if (!p.loadMedia || !img.externalMediaId) return { status: "failed", reason: "media_unavailable" };
  try {
    const media = await p.loadMedia({
      tenantId: p.tenantId,
      conversationId: p.conversationId,
      externalMediaId: img.externalMediaId,
      mimeType: img.mimeType,
    });
    if (media.data.byteLength === 0) return { status: "failed", reason: "empty_image" };
    if (media.data.byteLength > MAX_RECEIPT_IMAGE_BYTES) return { status: "failed", reason: "image_too_large" };
    const mimeType = media.mimeType || img.mimeType || "image/jpeg";
    if (!mimeType.startsWith("image/")) return { status: "failed", reason: "not_an_image" };
    const res = await p.provider.chat({
      model: p.model,
      messages: buildReceiptMessages({ mimeType, data: media.data }, { currency: img.order.currency }),
      responseFormat: receiptResponseFormat,
      temperature: 0,
      maxTokens: 300,
    });
    const out = res.parsed;
    if (!out) return { status: "failed", reason: "invalid_output", model: p.model, usage: res.usage };
    return {
      status: "extracted",
      amountMinor: amountToMinor(out.amount),
      currency: normalizeCurrency(out.currency),
      date: out.date?.slice(0, 40) ?? null,
      reference: out.reference?.slice(0, 120) ?? null,
      confidence: out.isReceipt ? out.confidence : Math.min(out.confidence, 0.1),
      isReceipt: out.isReceipt,
      model: p.model,
      usage: res.usage,
    };
  } catch (err) {
    p.logger.warn(`receipt extraction failed (${err instanceof Error ? err.name : "unknown"})`);
    return { status: "failed", reason: "vision_error" };
  }
}

export interface NewReview {
  orderId: string;
  conversationId: string;
  messageId: string;
  attachmentId: string | null;
  extraction: "extracted" | "unsupported" | "failed";
  amountMinor: bigint | null;
  currency: string | null;
  date: string | null;
  reference: string | null;
  confidence: number | null;
  model: string | null;
}

export interface ConversationState {
  aiMode: string;
  assignedUserId: string | null;
  status: string;
  lastInboundAt: Date | null;
}

/** Writes of the receipt flow (one transaction). Deliberately has NO order/payment method. */
export interface ReceiptTxStore {
  reviewExists(messageId: string): Promise<boolean>;
  insertReview(r: NewReview): Promise<string | null>;
  recordVisionUsage(u: { model: string; usage: TokenUsage; reviewId: string | null }): Promise<void>;
  notify(n: NewNotification): Promise<void>;
  conversationState(): Promise<ConversationState | undefined>;
  insertReply(body: string, clientMessageId: string): Promise<string | null>;
  findReply(clientMessageId: string): Promise<{ id: string; queued: boolean } | undefined>;
}

export interface ReceiptFlowPorts {
  inTx<T>(fn: (s: ReceiptTxStore) => Promise<T>): Promise<T>;
  extract(): Promise<VisionOutcome>;
  canAutoReply(conv: ConversationState): boolean;
  replyClientMessageId: string;
}

export interface ReceiptFlowInput {
  conversationId: string;
  messageId: string;
  image: ReceiptImage;
}

export interface ReceiptFlowResult {
  outcome: "created" | "already-processed";
  reviewId: string | null;
  replied: boolean;
  enqueueMessageId?: string;
  events: InboxEvent[];
}

/**
 * Orchestrates one receipt: replay guard, extraction outside any transaction, then the review row,
 * the cost, the team notification and the "we are verifying" reply in one transaction.
 */
export async function handleReceipt(ports: ReceiptFlowPorts, input: ReceiptFlowInput): Promise<ReceiptFlowResult> {
  const replay = await ports.inTx(async (s) => {
    if (!(await s.reviewExists(input.messageId))) return null;
    const reply = await s.findReply(ports.replyClientMessageId);
    return reply;
  });
  if (replay !== null) {
    const lost = replay?.queued ? replay.id : undefined;
    return {
      outcome: "already-processed",
      reviewId: null,
      replied: false,
      ...(lost ? { enqueueMessageId: lost } : {}),
      events: lost ? [{ type: "message.created", conversationId: input.conversationId, messageId: lost }] : [],
    };
  }

  const vision = await ports.extract();

  return ports.inTx(async (s) => {
    const extracted = vision.status === "extracted" ? vision : undefined;
    const reviewId = await s.insertReview({
      orderId: input.image.order.id,
      conversationId: input.conversationId,
      messageId: input.messageId,
      attachmentId: input.image.attachmentId,
      extraction: vision.status,
      amountMinor: extracted?.amountMinor ?? null,
      currency: extracted?.currency ?? null,
      date: extracted?.date ?? null,
      reference: extracted?.reference ?? null,
      confidence: extracted ? Math.max(0, Math.min(1, extracted.confidence)) : null,
      model: vision.status === "unsupported" ? null : (vision.model ?? null),
    });
    if (reviewId === null) {
      return { outcome: "already-processed", reviewId: null, replied: false, events: [] } satisfies ReceiptFlowResult;
    }
    // Vision cost counts toward the tenant budget like any other LLM call.
    if (vision.status !== "unsupported" && vision.model && vision.usage) {
      await s.recordVisionUsage({ model: vision.model, usage: vision.usage, reviewId });
    }
    const amountTxt =
      extracted?.amountMinor !== null && extracted?.amountMinor !== undefined
        ? `${(Number(extracted.amountMinor) / 100).toFixed(2)} ${extracted.currency ?? ""}`.trim()
        : "monto no leído";
    await s.notify({
      kind: "payment_review",
      title: `Comprobante recibido para el pedido ${input.image.order.number}`,
      body: `Revisar pago (${amountTxt}). Total del pedido: ${(Number(input.image.order.totalMinor) / 100).toFixed(2)} ${input.image.order.currency}.`,
      entity: "payment_review",
      entityId: reviewId,
      conversationId: input.conversationId,
      dedupeKey: `payment_review:${reviewId}`,
    });
    const events: InboxEvent[] = [];
    let enqueueMessageId: string | undefined;
    const conv = await s.conversationState();
    if (conv && ports.canAutoReply(conv)) {
      const id = await s.insertReply(RECEIPT_ACK_TEXT(input.image.order.number), ports.replyClientMessageId);
      if (id) {
        enqueueMessageId = id;
        events.push({ type: "message.created", conversationId: input.conversationId, messageId: id });
      }
    }
    return {
      outcome: "created",
      reviewId,
      replied: enqueueMessageId !== undefined,
      ...(enqueueMessageId ? { enqueueMessageId } : {}),
      events,
    } satisfies ReceiptFlowResult;
  });
}

/** Postgres adapter of ReceiptTxStore (RLS-scoped tx from withTenant). */
export function createPgReceiptStore(tx: Transaction, tenantId: string, conversationId: string, messageId: string): ReceiptTxStore {
  return {
    async reviewExists(mid) {
      const [r] = await tx.select({ id: paymentReviews.id }).from(paymentReviews).where(eq(paymentReviews.messageId, mid)).limit(1);
      return r !== undefined;
    },
    async insertReview(r) {
      const rows = await tx
        .insert(paymentReviews)
        .values({
          tenantId,
          orderId: r.orderId,
          conversationId: r.conversationId,
          messageId: r.messageId,
          attachmentId: r.attachmentId,
          status: "pending",
          extraction: r.extraction,
          extractedAmountMinor: r.amountMinor,
          extractedCurrency: r.currency,
          extractedDate: r.date,
          extractedReference: r.reference,
          confidence: r.confidence === null ? null : r.confidence.toFixed(3),
          model: r.model,
        })
        .onConflictDoNothing({ target: [paymentReviews.tenantId, paymentReviews.messageId] })
        .returning({ id: paymentReviews.id });
      return rows[0]?.id ?? null;
    },
    async recordVisionUsage({ model, usage, reviewId }) {
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
          purpose: "receipt_vision",
          paymentReviewId: reviewId,
          messageId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          promptVersion: RECEIPT_PROMPT_VERSION,
          verified: cost.verified,
          priceKnown: cost.known,
          unit: "usd_microcents",
        },
      });
    },
    async notify(n) {
      await insertNotification(tx, tenantId, n);
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
      await tx.update(conversations).set({ lastMessageAt: new Date(), updatedAt: new Date() }).where(eq(conversations.id, conversationId));
      return msg.id;
    },
    async findReply(clientMessageId) {
      const [m] = await tx
        .select({ id: messages.id, status: messages.status, externalId: messages.externalId })
        .from(messages)
        .where(eq(messages.clientMessageId, clientMessageId))
        .limit(1);
      return m ? { id: m.id, queued: m.status === "queued" && !m.externalId } : undefined;
    },
  };
}

export function pgReceiptPorts(db: Database, tenantId: string, conversationId: string, messageId: string) {
  return <T>(fn: (s: ReceiptTxStore) => Promise<T>): Promise<T> =>
    withTenant(db, tenantId, (tx) => fn(createPgReceiptStore(tx, tenantId, conversationId, messageId)));
}
