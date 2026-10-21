import type { VerifiedPaymentEvent } from "@crmwsp/payments";
import { transitionOrder, type OrderFulfillment, type OrderStatus } from "@crmwsp/domain";
import type { PaymentProviderName } from "@crmwsp/db";

/*
 * Applies signature-verified Stripe events to payments/orders. The ONLY code path that moves an
 * order to `paid` with verified_by = 'webhook'. Everything happens in ONE tenant transaction:
 *   1. insert the dedupe row (tenant, provider, event id) ON CONFLICT DO NOTHING -> replay = no-op;
 *   2. lock payment (by provider ref) and order FOR UPDATE;
 *   3. reference, amount and currency must match the payment snapshot AND the order total;
 *   4. pending_payment -> paid (commit_stock, payment succeeded, audit) or record why not.
 * Any thrown error rolls back the dedupe row as well, so the provider's retry re-applies it.
 */

export type PaymentEventOutcome =
  | "applied"
  | "duplicate"
  | "ignored"
  | "reference_mismatch"
  | "unknown_payment"
  | "amount_mismatch"
  | "currency_mismatch"
  | "already_paid"
  | "invalid_order_state"
  | "payment_failed"
  | "payment_expired"
  | "refund_not_handled";

export interface PaymentRecord {
  id: string;
  orderId: string;
  amountMinor: bigint;
  currency: string;
  status: "pending" | "succeeded" | "failed" | "expired";
}

export interface OrderRecord {
  id: string;
  status: OrderStatus;
  fulfillment: OrderFulfillment;
  totalMinor: bigint;
  currency: string;
}

export interface MarkPaidInput {
  orderId: string;
  paymentId: string;
  fromStatus: OrderStatus;
  paidAt: Date;
  eventId: string;
  amountMinor: bigint;
  currency: string;
}

/** Operations available inside one tenant-scoped transaction. */
export interface PaymentLedgerTx {
  /** Returns the new row id, or null when this event id was already recorded for the tenant. */
  recordEvent(e: { eventId: string; eventType: string; providerRef: string | null; payload: unknown }): Promise<string | null>;
  setEventOutcome(id: string, outcome: PaymentEventOutcome, paymentId: string | null): Promise<void>;
  lockPaymentByRef(providerRef: string): Promise<PaymentRecord | null>;
  lockOrder(orderId: string): Promise<OrderRecord | null>;
  /** commit_stock + order paid + payment succeeded (verified_by='webhook') + audit. */
  markOrderPaid(input: MarkPaidInput): Promise<void>;
  setPaymentStatus(paymentId: string, status: "failed" | "expired"): Promise<void>;
}

export interface PaymentLedger {
  /** `provider` scopes dedupe rows and payment lookups (default stripe). */
  inTenant<T>(tenantId: string, fn: (tx: PaymentLedgerTx) => Promise<T>, provider?: PaymentProviderName): Promise<T>;
}

function eventTypeOf(e: VerifiedPaymentEvent): string {
  return e.type === "ignored" ? e.eventType : e.type;
}

export function applyStripeEvent(ledger: PaymentLedger, tenantId: string, event: VerifiedPaymentEvent, payload: unknown): Promise<PaymentEventOutcome> {
  return applyPaymentEvent(ledger, tenantId, event, payload, "stripe");
}

/** Same rules for every provider whose events are signature-verified (and, for Mercado Pago, API-confirmed). */
export async function applyPaymentEvent(
  ledger: PaymentLedger,
  tenantId: string,
  event: VerifiedPaymentEvent,
  payload: unknown,
  provider: PaymentProviderName,
): Promise<PaymentEventOutcome> {
  return ledger.inTenant(
    tenantId,
    async (tx) => {
      const providerRef = event.type === "ignored" ? null : event.providerRef;
      const rowId = await tx.recordEvent({ eventId: event.dedupeKey, eventType: eventTypeOf(event), providerRef, payload });
      if (rowId === null) return "duplicate";
      const { outcome, paymentId } = await decide(tx, tenantId, event);
      await tx.setEventOutcome(rowId, outcome, paymentId);
      return outcome;
    },
    provider,
  );
}

async function decide(
  tx: PaymentLedgerTx,
  tenantId: string,
  event: VerifiedPaymentEvent,
): Promise<{ outcome: PaymentEventOutcome; paymentId: string | null }> {
  const none = (outcome: PaymentEventOutcome) => ({ outcome, paymentId: null });
  if (event.type === "ignored") return none("ignored");
  if (event.type === "payment.refunded") return none("refund_not_handled");
  if (event.verifiedBy !== "webhook") return none("ignored");

  // Metadata must point at an order of THIS tenant (the token resolved the tenant).
  const ref = event.reference;
  if (!ref || ref.kind !== "order" || ref.tenantId !== tenantId) return none("reference_mismatch");

  const payment = await tx.lockPaymentByRef(event.providerRef);
  if (!payment) return none("unknown_payment");
  const withPayment = (outcome: PaymentEventOutcome) => ({ outcome, paymentId: payment.id });
  if (payment.orderId !== ref.id) return withPayment("reference_mismatch");

  if (event.type === "payment.failed" || event.type === "payment.expired") {
    if (payment.status === "pending") await tx.setPaymentStatus(payment.id, event.type === "payment.failed" ? "failed" : "expired");
    return withPayment(event.type === "payment.failed" ? "payment_failed" : "payment_expired");
  }

  // payment.succeeded
  const order = await tx.lockOrder(payment.orderId);
  if (!order) return withPayment("unknown_payment");
  const currency = event.currency.toUpperCase();
  if (currency !== payment.currency.toUpperCase() || currency !== order.currency.toUpperCase()) {
    return withPayment("currency_mismatch");
  }
  if (!Number.isSafeInteger(event.amountMinor)) return withPayment("amount_mismatch");
  const amount = BigInt(event.amountMinor);
  if (amount !== payment.amountMinor || amount !== order.totalMinor) return withPayment("amount_mismatch");
  if (payment.status === "succeeded") return withPayment("already_paid");

  const t = transitionOrder(order.status, "mark_paid", order.fulfillment);
  // E.g. cancelled or already paid via another link: money arrived but the order cannot take it.
  // Recorded for a human (refund); never silently re-opens the order.
  if (!t.ok || t.to !== "paid") return withPayment(order.status === "paid" ? "already_paid" : "invalid_order_state");

  await tx.markOrderPaid({
    orderId: order.id,
    paymentId: payment.id,
    fromStatus: order.status,
    paidAt: new Date(),
    eventId: event.dedupeKey,
    amountMinor: amount,
    currency,
  });
  return withPayment("applied");
}
