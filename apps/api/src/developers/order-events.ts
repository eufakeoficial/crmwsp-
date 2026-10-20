import { enqueueWebhookEvent, eq, orders, type Transaction } from "@crmwsp/db";

/**
 * Queues an `order.*` outbound webhook in the caller's transaction (outbox): the event exists iff
 * the state change commits. Payload carries ids and money only, as strings (no bigint in JSON).
 */
export async function emitOrderWebhook(tx: Transaction, tenantId: string, type: "order.created" | "order.paid", orderId: string): Promise<void> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return;
  await enqueueWebhookEvent(tx, tenantId, type, {
    orderId: o.id,
    number: o.number,
    status: o.status,
    currency: o.currency,
    totalMinor: o.totalMinor.toString(),
    contactId: o.contactId,
    conversationId: o.conversationId,
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
  });
}
