import {
  and,
  auditEvents,
  eq,
  followUps,
  inArray,
  orders,
  paymentEvents,
  payments,
  sql,
  withTenant,
  type Database,
  type Transaction,
} from "@crmwsp/db";
import type { MarkPaidInput, OrderRecord, PaymentEventOutcome, PaymentLedger, PaymentLedgerTx, PaymentRecord } from "./payment-ledger.js";

/** Drizzle implementation; every call runs under withTenant (RLS, ADR 0002). */
export class PgPaymentLedger implements PaymentLedger {
  constructor(private readonly db: Database) {}

  inTenant<T>(tenantId: string, fn: (tx: PaymentLedgerTx) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, (tx) => fn(new PgLedgerTx(tx, tenantId)));
  }
}

class PgLedgerTx implements PaymentLedgerTx {
  constructor(
    private readonly tx: Transaction,
    private readonly tenantId: string,
  ) {}

  async recordEvent(e: { eventId: string; eventType: string; providerRef: string | null; payload: unknown }): Promise<string | null> {
    const rows = await this.tx
      .insert(paymentEvents)
      .values({
        tenantId: this.tenantId,
        provider: "stripe",
        eventId: e.eventId.slice(0, 255),
        eventType: e.eventType.slice(0, 120),
        providerRef: e.providerRef,
        outcome: "processing",
        payload: e.payload ?? null,
      })
      .onConflictDoNothing({ target: [paymentEvents.tenantId, paymentEvents.provider, paymentEvents.eventId] })
      .returning({ id: paymentEvents.id });
    return rows[0]?.id ?? null;
  }

  async setEventOutcome(id: string, outcome: PaymentEventOutcome, paymentId: string | null): Promise<void> {
    await this.tx.update(paymentEvents).set({ outcome, paymentId }).where(eq(paymentEvents.id, id));
  }

  async lockPaymentByRef(providerRef: string): Promise<PaymentRecord | null> {
    const [p] = await this.tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, "stripe"), eq(payments.providerRef, providerRef)))
      .for("update");
    return p ? { id: p.id, orderId: p.orderId, amountMinor: p.amountMinor, currency: p.currency, status: p.status } : null;
  }

  async lockOrder(orderId: string): Promise<OrderRecord | null> {
    const [o] = await this.tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    return o ? { id: o.id, status: o.status, fulfillment: o.fulfillment, totalMinor: o.totalMinor, currency: o.currency } : null;
  }

  async markOrderPaid(i: MarkPaidInput): Promise<void> {
    await this.tx.execute(sql`select public.commit_stock(${i.orderId}::uuid)`);
    const updated = await this.tx
      .update(orders)
      .set({ status: "paid", paidAt: i.paidAt, lockVersion: sql`${orders.lockVersion} + 1`, updatedAt: i.paidAt })
      .where(and(eq(orders.id, i.orderId), eq(orders.status, i.fromStatus)))
      .returning({ id: orders.id });
    // The row is locked FOR UPDATE, so this only fires on a logic error: abort the whole transaction.
    if (updated.length !== 1) throw new Error("order state changed while locked");
    await this.tx
      .update(payments)
      .set({ status: "succeeded", verifiedBy: "webhook", paidAt: i.paidAt, updatedAt: i.paidAt })
      .where(eq(payments.id, i.paymentId));
    // Paid orders need no more nudges: cancel pending follow-ups atomically with the payment.
    await this.tx
      .update(followUps)
      .set({ status: "cancelled", skipReason: "order_paid", updatedAt: sql`now()` })
      .where(and(eq(followUps.orderId, i.orderId), inArray(followUps.status, ["suggested", "scheduled"])));
    await this.tx.insert(auditEvents).values({
      tenantId: this.tenantId,
      actorType: "system",
      actorId: null,
      entity: "order",
      entityId: i.orderId,
      action: "order.mark_paid",
      diff: {
        status: { from: i.fromStatus, to: "paid" },
        method: "stripe",
        verifiedBy: "webhook",
        paymentId: i.paymentId,
        eventId: i.eventId,
        amountMinor: i.amountMinor.toString(),
        currency: i.currency,
      },
      reason: "pago verificado por webhook de Stripe",
    });
  }

  async setPaymentStatus(paymentId: string, status: "failed" | "expired"): Promise<void> {
    await this.tx
      .update(payments)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")));
  }
}
