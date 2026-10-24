import type { QuoteActivityEvent, QuoteActivityKind, QuoteActivityVerifier } from "@crmwsp/contracts";

/*
 * Activity history of a quote, derived from timestamps that already exist (no events table):
 * quote columns, its orders, payment receipts (payment_reviews), provider payments and the
 * audited manual mark-paid rows of audit_events.
 */

export interface QuoteActivityQuote {
  id: string;
  createdAt: Date;
  approvedAt: Date | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
}

export interface QuoteActivityOrder {
  id: string;
  number: string;
  createdAt: Date;
  paidAt: Date | null;
  cancelledAt: Date | null;
}

export interface QuoteActivityReview {
  id: string;
  orderId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  reviewedAt: Date | null;
}

/** A provider payment; only rows with `paidAt` and a verifier count as paid. */
export interface QuoteActivityPayment {
  orderId: string;
  paidAt: Date | null;
  verifiedBy: "webhook" | "reconciliation" | null;
}

/** An audited manual mark-paid (`audit_events` order.mark_paid with verifiedBy manual). */
export interface QuoteActivityManualPayment {
  orderId: string;
  at: Date;
}

export interface QuoteActivityInput {
  quote: QuoteActivityQuote;
  orders: readonly QuoteActivityOrder[];
  reviews: readonly QuoteActivityReview[];
  payments: readonly QuoteActivityPayment[];
  manualPayments: readonly QuoteActivityManualPayment[];
}

/** Lifecycle order, used to break ties between events with the same timestamp. */
const KIND_RANK: Record<QuoteActivityKind, number> = {
  quote_created: 0,
  quote_approved: 1,
  quote_sent: 2,
  quote_accepted: 3,
  order_created: 4,
  payment_review_received: 5,
  payment_review_approved: 6,
  payment_review_rejected: 6,
  order_paid: 7,
  order_cancelled: 8,
};

/** Builds the chronological (oldest first) activity list; ties break by lifecycle order. */
export function buildQuoteActivity(input: QuoteActivityInput): QuoteActivityEvent[] {
  const events: QuoteActivityEvent[] = [];
  const push = (
    kind: QuoteActivityKind,
    key: string,
    at: Date | null,
    extra: { orderNumber?: string; verifiedBy?: QuoteActivityVerifier } = {},
  ): void => {
    if (!at || Number.isNaN(at.getTime())) return;
    events.push({
      id: `${kind}:${key}`,
      kind,
      at: at.toISOString(),
      orderNumber: extra.orderNumber ?? null,
      verifiedBy: extra.verifiedBy ?? null,
    });
  };

  const q = input.quote;
  push("quote_created", q.id, q.createdAt);
  push("quote_approved", q.id, q.approvedAt);
  push("quote_sent", q.id, q.sentAt);
  push("quote_accepted", q.id, q.acceptedAt);

  for (const o of input.orders) {
    const orderNumber = o.number;
    push("order_created", o.id, o.createdAt, { orderNumber });
    push("order_cancelled", o.id, o.cancelledAt, { orderNumber });
    for (const r of input.reviews) {
      if (r.orderId !== o.id) continue;
      push("payment_review_received", r.id, r.createdAt, { orderNumber });
      if (r.status === "approved") push("payment_review_approved", r.id, r.reviewedAt, { orderNumber });
      if (r.status === "rejected") push("payment_review_rejected", r.id, r.reviewedAt, { orderNumber });
    }
    // One "paid" entry per order. Provider-verified wins over manual; the order's own paid_at is
    // the fallback so a paid order never shows up without its payment (verifier then unknown).
    const provider = input.payments
      .filter((p) => p.orderId === o.id && p.paidAt && p.verifiedBy)
      .sort((a, b) => (a.paidAt as Date).getTime() - (b.paidAt as Date).getTime())[0];
    const manual = input.manualPayments.filter((m) => m.orderId === o.id).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
    if (provider?.paidAt && provider.verifiedBy) {
      push("order_paid", o.id, provider.paidAt, { orderNumber, verifiedBy: provider.verifiedBy });
    } else if (manual) {
      push("order_paid", o.id, manual.at, { orderNumber, verifiedBy: "manual" });
    } else if (o.paidAt) {
      push("order_paid", o.id, o.paidAt, { orderNumber });
    }
  }

  return events.sort((a, b) => a.at.localeCompare(b.at) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id));
}
