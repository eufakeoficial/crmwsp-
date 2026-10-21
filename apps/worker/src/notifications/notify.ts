import { notifications, type NotificationKind, type Transaction } from "@crmwsp/db";

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  entity?: string | null;
  entityId?: string | null;
  conversationId?: string | null;
  /** Idempotency key per tenant (e.g. `handoff:<actionId>`); a replay inserts nothing. */
  dedupeKey: string;
}

/**
 * Inserts a team notification inside the caller's transaction (RLS-scoped). Delivery (SSE +
 * owner WhatsApp) is done by the notification tick after commit. Bodies must not contain secrets;
 * customer message text is never copied here.
 */
export async function insertNotification(tx: Transaction, tenantId: string, n: NewNotification): Promise<string | null> {
  const rows = await tx
    .insert(notifications)
    .values({
      tenantId,
      kind: n.kind,
      title: n.title.slice(0, 200),
      body: n.body ? n.body.slice(0, 1000) : null,
      entity: n.entity ?? null,
      entityId: n.entityId ?? null,
      conversationId: n.conversationId ?? null,
      dedupeKey: n.dedupeKey.slice(0, 200),
    })
    .onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] })
    .returning({ id: notifications.id });
  return rows[0]?.id ?? null;
}
