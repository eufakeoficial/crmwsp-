import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { webhookDeliveries, webhookEndpoints } from "./schema/developers.js";

export type OutboundWebhookEventType = "order.created" | "order.paid" | "contact.created" | "message.received";

/**
 * Transactional outbox for outbound webhooks: inserts one pending delivery per active endpoint of
 * this tenant subscribed to `type`. Call it inside the same `withTenant` transaction as the state
 * change, so the event exists iff the change committed. Returns the number of deliveries queued.
 */
export async function enqueueWebhookEvent(
  tx: Transaction,
  tenantId: string,
  type: OutboundWebhookEventType,
  data: Record<string, unknown>,
  now: Date = new Date(),
): Promise<number> {
  const endpoints = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.status, "active"), sql`${webhookEndpoints.events} @> ARRAY[${type}]::text[]`));
  if (endpoints.length === 0) return 0;
  const eventId = randomUUID();
  const payload = { id: eventId, type, createdAt: now.toISOString(), data };
  const rows = await tx
    .insert(webhookDeliveries)
    .values(endpoints.map((e) => ({ tenantId, endpointId: e.id, eventId, eventType: type, payload, nextAttemptAt: now })))
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  return rows.length;
}
