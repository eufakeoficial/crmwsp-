import type { NotificationSettings } from "@crmwsp/contracts";
import type { NotificationKind } from "@crmwsp/db";

/** WhatsApp free-form messages are only allowed within 24 h of the recipient's last inbound message. */
export const OWNER_SESSION_WINDOW_MS = 24 * 3600 * 1000;

export interface PendingNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
}

export interface OwnerConversation {
  conversationId: string;
  lastInboundAt: Date | null;
  channelActive: boolean;
}

export type WhatsappOutcome =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; reason: "kind_disabled" | "no_owner_conversation" | "window_closed" | "channel_unavailable" }
  | { status: "not_configured" };

/** Port over the tenant's tables; `tx`-bound in production, in-memory in tests. */
export interface NotificationStore {
  lockUndispatched(limit: number): Promise<PendingNotification[]>;
  ownerConversation(phoneE164: string): Promise<OwnerConversation | null>;
  /** Inserts a queued outbound text (author system) and returns its id. Idempotent per notification. */
  insertOwnerMessage(n: PendingNotification, conversationId: string, body: string): Promise<string>;
  markDispatched(id: string, outcome: WhatsappOutcome, now: Date): Promise<void>;
}

export interface DispatchResult {
  notificationIds: Array<{ id: string; kind: NotificationKind }>;
  messageIds: string[];
  skipped: Array<{ id: string; reason: string }>;
}

export function ownerMessageText(n: Pick<PendingNotification, "title" | "body">): string {
  return (n.body ? `${n.title}\n${n.body}` : n.title).slice(0, 1000);
}

/**
 * Decides the WhatsApp leg of each undispatched notification. The owner number must have an open
 * 24 h session (no approved owner template exists yet): otherwise the WhatsApp leg is skipped and
 * logged; the in-app notification is still published.
 */
export async function dispatchNotifications(
  store: NotificationStore,
  settings: NotificationSettings,
  now: Date,
  limit = 50,
): Promise<DispatchResult> {
  const res: DispatchResult = { notificationIds: [], messageIds: [], skipped: [] };
  const pending = await store.lockUndispatched(limit);
  let owner: OwnerConversation | null | undefined;
  for (const n of pending) {
    let outcome: WhatsappOutcome;
    if (!settings.ownerPhoneE164) outcome = { status: "not_configured" };
    else if (!settings.whatsappKinds.includes(n.kind)) outcome = { status: "skipped", reason: "kind_disabled" };
    else {
      if (owner === undefined) owner = await store.ownerConversation(settings.ownerPhoneE164);
      if (!owner) outcome = { status: "skipped", reason: "no_owner_conversation" };
      else if (!owner.channelActive) outcome = { status: "skipped", reason: "channel_unavailable" };
      else if (!owner.lastInboundAt || now.getTime() - owner.lastInboundAt.getTime() >= OWNER_SESSION_WINDOW_MS) {
        outcome = { status: "skipped", reason: "window_closed" };
      } else {
        const messageId = await store.insertOwnerMessage(n, owner.conversationId, ownerMessageText(n));
        outcome = { status: "sent", messageId };
        res.messageIds.push(messageId);
      }
    }
    if (outcome.status === "skipped") res.skipped.push({ id: n.id, reason: outcome.reason });
    await store.markDispatched(n.id, outcome, now);
    res.notificationIds.push({ id: n.id, kind: n.kind });
  }
  return res;
}
