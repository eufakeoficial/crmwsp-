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

/**
 * Verified owner-mode phone (F9). Owner-mode routing never creates a conversation for it, so the
 * notification is sent directly to the phone on the channel the owner last wrote to.
 */
export interface OwnerDirectTarget {
  channelConnectionId: string;
  /** Last owner-mode message received from that phone (opens the 24 h window). */
  lastInboundAt: Date | null;
  channelActive: boolean;
  /** Owner user email, for the fallback when the window is closed. */
  email: string | null;
}

export interface DirectSend {
  notificationId: string;
  channelConnectionId: string;
  toE164: string;
  text: string;
}

export interface EmailFallback {
  notificationId: string;
  to: string | null;
  title: string;
  body: string | null;
}

export type WhatsappOutcome =
  | { status: "sent"; messageId: string | null }
  | { status: "skipped"; reason: "kind_disabled" | "no_owner_conversation" | "window_closed" | "channel_unavailable" }
  | { status: "not_configured" };

/** Port over the tenant's tables; `tx`-bound in production, in-memory in tests. */
export interface NotificationStore {
  lockUndispatched(limit: number): Promise<PendingNotification[]>;
  ownerConversation(phoneE164: string): Promise<OwnerConversation | null>;
  /** Inserts a queued outbound text (author system) and returns its id. Idempotent per notification. */
  insertOwnerMessage(n: PendingNotification, conversationId: string, body: string): Promise<string>;
  /** Verified owner-mode phone of the tenant, when the number is one (F9). Optional for older stores. */
  ownerDirect?(phoneE164: string): Promise<OwnerDirectTarget | null>;
  markDispatched(id: string, outcome: WhatsappOutcome, now: Date): Promise<void>;
}

export interface DispatchResult {
  notificationIds: Array<{ id: string; kind: NotificationKind }>;
  messageIds: string[];
  skipped: Array<{ id: string; reason: string }>;
  /** Direct sends to a verified owner-mode phone, done by the caller after commit. */
  directSends: DirectSend[];
  /** Window closed on a verified owner-mode phone: the caller emails the owner (or logs). */
  emailFallbacks: EmailFallback[];
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
  const res: DispatchResult = { notificationIds: [], messageIds: [], skipped: [], directSends: [], emailFallbacks: [] };
  const pending = await store.lockUndispatched(limit);
  let owner: OwnerConversation | null | undefined;
  let direct: OwnerDirectTarget | null | undefined;
  for (const n of pending) {
    let outcome: WhatsappOutcome;
    if (!settings.ownerPhoneE164) outcome = { status: "not_configured" };
    else if (!settings.whatsappKinds.includes(n.kind)) outcome = { status: "skipped", reason: "kind_disabled" };
    else if ((direct ??= store.ownerDirect ? await store.ownerDirect(settings.ownerPhoneE164) : null)) {
      if (!direct.channelActive) outcome = { status: "skipped", reason: "channel_unavailable" };
      else if (!direct.lastInboundAt || now.getTime() - direct.lastInboundAt.getTime() >= OWNER_SESSION_WINDOW_MS) {
        outcome = { status: "skipped", reason: "window_closed" };
        res.emailFallbacks.push({ notificationId: n.id, to: direct.email, title: n.title, body: n.body });
      } else {
        res.directSends.push({ notificationId: n.id, channelConnectionId: direct.channelConnectionId, toE164: settings.ownerPhoneE164, text: ownerMessageText(n) });
        outcome = { status: "sent", messageId: null };
      }
    } else {
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
