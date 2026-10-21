import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  approvePaymentReviewRequestSchema,
  listPaymentReviewsQuerySchema,
  rejectPaymentReviewRequestSchema,
  type PaymentReview,
  type PaymentReviewList,
} from "@crmwsp/contracts";
import {
  and,
  contacts,
  conversations,
  desc,
  eq,
  isUuid,
  messages,
  orders,
  paymentReviews,
  sql,
  type Transaction,
} from "@crmwsp/db";
import type { Queue } from "bullmq";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import { mapStockError } from "../commerce/orders.controller.js";
import { markPaidManuallyTx } from "../commerce/orders.service.js";
import type { TenantDb } from "../db/tenant-db.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { writeAudit } from "../inbox/audit.js";
import { OUTBOUND_QUEUE, SEND_MESSAGE_JOB, SEND_MESSAGE_JOB_OPTIONS, type SendMessageJobData } from "../inbox/outbound.constants.js";

/** WhatsApp free-form messages need an inbound message from the customer in the last 24 h. */
const SESSION_WINDOW_MS = 24 * 3600 * 1000;

export const REJECT_TEXT = (orderNumber: string): string =>
  `Hola, revisamos el comprobante que enviaste para el pedido ${orderNumber} y no pudimos confirmar el pago. ` +
  `¿Podrías verificarlo o enviarnos otro comprobante? Gracias por tu paciencia.`;

type Row = {
  r: typeof paymentReviews.$inferSelect;
  o: { id: string; number: string; status: string; totalMinor: bigint; currency: string };
  c: { id: string; name: string | null; phoneE164: string | null };
};

export function toDto({ r, o, c }: Row): PaymentReview {
  const amountMinor = r.extractedAmountMinor === null ? null : Number(r.extractedAmountMinor);
  return {
    id: r.id,
    status: r.status,
    extraction: r.extraction,
    order: { id: o.id, number: o.number, status: o.status, totalMinor: Number(o.totalMinor), currency: o.currency },
    contact: { id: c.id, name: c.name, phoneE164: c.phoneE164 },
    conversationId: r.conversationId,
    messageId: r.messageId,
    hasImage: r.attachmentId !== null,
    attachmentId: r.attachmentId,
    extracted: {
      amountMinor,
      currency: r.extractedCurrency,
      date: r.extractedDate,
      reference: r.extractedReference,
      confidence: r.confidence === null ? null : Number(r.confidence),
    },
    amountMatches:
      r.extractedAmountMinor !== null &&
      r.extractedAmountMinor === o.totalMinor &&
      (r.extractedCurrency ?? "").toUpperCase() === o.currency.toUpperCase(),
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    rejectReason: r.rejectReason,
    createdAt: r.createdAt.toISOString(),
  };
}

async function selectReviews(tx: Transaction, where: ReturnType<typeof and>, limit: number): Promise<PaymentReview[]> {
  const rows = await tx
    .select({
      r: paymentReviews,
      o: { id: orders.id, number: orders.number, status: orders.status, totalMinor: orders.totalMinor, currency: orders.currency },
      c: { id: contacts.id, name: contacts.name, phoneE164: contacts.phoneE164 },
    })
    .from(paymentReviews)
    .innerJoin(orders, eq(orders.id, paymentReviews.orderId))
    .innerJoin(contacts, eq(contacts.id, orders.contactId))
    .where(where)
    .orderBy(desc(paymentReviews.createdAt), desc(paymentReviews.id))
    .limit(limit);
  return rows.map(toDto);
}

async function loadReview(tx: Transaction, id: string): Promise<PaymentReview> {
  const [r] = await selectReviews(tx, and(eq(paymentReviews.id, id)), 1);
  if (!r) throw new NotFoundError();
  return r;
}

async function lockPending(tx: Transaction, id: string): Promise<typeof paymentReviews.$inferSelect> {
  const [r] = await tx.select().from(paymentReviews).where(eq(paymentReviews.id, id)).for("update");
  if (!r) throw new NotFoundError();
  if (r.status !== "pending") throw new ConflictError(`Payment review is already ${r.status}`);
  return r;
}

/**
 * Human verification of customer receipts (T8). Approval is the ONLY way a receipt leads to a paid
 * order, and it runs the audited manual mark-paid path with the reviewer as `verifiedByUserId`.
 */
@Controller("payment-reviews")
@UseGuards(TenantGuard)
export class PaymentReviewsController {
  constructor(
    @Inject(OUTBOUND_QUEUE) private readonly queue: Queue,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<PaymentReviewList> {
    const q = parseOrThrow(listPaymentReviewsQuerySchema, query);
    return { items: await db.run((tx) => selectReviews(tx, and(eq(paymentReviews.status, q.status)), q.limit)) };
  }

  @Get(":id")
  async detail(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<PaymentReview> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run((tx) => loadReview(tx, id));
  }

  @Post(":id/approve")
  @Roles("owner", "admin")
  @HttpCode(200)
  async approve(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<PaymentReview> {
    if (!isUuid(id)) throw new NotFoundError();
    const { note } = parseOrThrow(approvePaymentReviewRequestSchema, body ?? {});
    try {
      return await db.run(async (tx) => {
        const r = await lockPending(tx, id);
        await markPaidManuallyTx(tx, { tenantId: db.tenantId, userId: db.userId, ip: req.ip }, r.orderId, {
          reason: `comprobante verificado por revisión ${r.id}${note ? `: ${note}` : ""}`,
          paymentReviewId: r.id,
        });
        const now = new Date();
        await tx
          .update(paymentReviews)
          .set({ status: "approved", reviewedBy: db.userId, reviewedAt: now, updatedAt: now })
          .where(eq(paymentReviews.id, r.id));
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "payment_review",
          entityId: r.id,
          action: "payment_review.approve",
          diff: { status: { from: "pending", to: "approved" }, orderId: r.orderId },
          ip: req.ip,
          reason: note,
        });
        return loadReview(tx, r.id);
      });
    } catch (err) {
      return mapStockError(err);
    }
  }

  @Post(":id/reject")
  @Roles("owner", "admin")
  @HttpCode(200)
  async reject(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<PaymentReview> {
    if (!isUuid(id)) throw new NotFoundError();
    const { reason } = parseOrThrow(rejectPaymentReviewRequestSchema, body);
    const out = await db.run(async (tx) => {
      const r = await lockPending(tx, id);
      const now = new Date();
      await tx
        .update(paymentReviews)
        .set({ status: "rejected", reviewedBy: db.userId, reviewedAt: now, rejectReason: reason, updatedAt: now })
        .where(eq(paymentReviews.id, r.id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "payment_review",
        entityId: r.id,
        action: "payment_review.reject",
        diff: { status: { from: "pending", to: "rejected" }, orderId: r.orderId },
        ip: req.ip,
        reason,
      });
      // Polite message to the customer, only inside the WhatsApp 24 h session window.
      const [conv] = await tx
        .select({ lastInboundAt: conversations.lastInboundAt })
        .from(conversations)
        .where(eq(conversations.id, r.conversationId));
      const [o] = await tx.select({ number: orders.number }).from(orders).where(eq(orders.id, r.orderId));
      let messageId: string | null = null;
      if (conv?.lastInboundAt && now.getTime() - conv.lastInboundAt.getTime() < SESSION_WINDOW_MS && o) {
        const [m] = await tx
          .insert(messages)
          .values({
            tenantId: db.tenantId,
            conversationId: r.conversationId,
            direction: "outbound",
            type: "text",
            body: REJECT_TEXT(o.number),
            status: "queued",
            author: "user",
            authorUserId: db.userId,
            // Deterministic per review: a retried reject never sends twice.
            clientMessageId: r.id,
          })
          .onConflictDoNothing({
            target: [messages.tenantId, messages.clientMessageId],
            where: sql`${messages.clientMessageId} is not null`,
          })
          .returning({ id: messages.id });
        messageId = m?.id ?? null;
        if (messageId) {
          await tx.update(conversations).set({ lastMessageAt: now, updatedAt: now }).where(eq(conversations.id, r.conversationId));
        }
      }
      return { review: await loadReview(tx, r.id), messageId, conversationId: r.conversationId };
    });
    if (out.messageId) {
      const data: SendMessageJobData = { tenantId: db.tenantId, messageId: out.messageId };
      await this.queue.add(SEND_MESSAGE_JOB, data, { ...SEND_MESSAGE_JOB_OPTIONS, jobId: out.messageId });
      await this.hub.publish(db.tenantId, { type: "message.created", conversationId: out.conversationId, messageId: out.messageId });
    }
    return out.review;
  }
}
