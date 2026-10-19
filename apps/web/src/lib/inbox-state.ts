import type { Conversation, Message } from "@crmwsp/contracts";

/** Identity of a message: optimistic and server copies share the clientMessageId. */
const keyOf = (m: Message): string => m.clientMessageId ?? m.id;

/** Chronological order: oldest first. */
export function sortMessages(list: readonly Message[]): Message[] {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Merges messages (any order) into the oldest-first timeline. A message from the server replaces
 * its optimistic copy (same clientMessageId); `incoming` wins over `current` on conflicts.
 */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const byKey = new Map<string, Message>();
  for (const m of current) byKey.set(keyOf(m), m);
  for (const m of incoming) {
    const prev = byKey.get(keyOf(m));
    byKey.set(keyOf(m), prev ? pickNewer(prev, m) : m);
  }
  return sortMessages([...byKey.values()]);
}

/** Delivery progress; a late 202 ("queued") must not roll back a status already seen via SSE. */
const STATUS_RANK: Record<Message["status"], number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4, received: 0 };
const isOptimistic = (m: Message): boolean => m.clientMessageId !== null && m.id === m.clientMessageId;

function pickNewer(prev: Message, next: Message): Message {
  if (isOptimistic(prev)) return next;
  if (isOptimistic(next)) return prev;
  return STATUS_RANK[next.status] < STATUS_RANK[prev.status] ? prev : next;
}

/** Local "queued" copy shown before the 202 response. Its id is the clientMessageId. */
export function optimisticMessage(conversationId: string, text: string, clientMessageId: string, userId: string, now = new Date()): Message {
  return {
    id: clientMessageId,
    conversationId,
    direction: "outbound",
    type: "text",
    body: text,
    status: "queued",
    author: "user",
    authorUserId: userId,
    clientMessageId,
    error: null,
    sentAt: null,
    createdAt: now.toISOString(),
    attachments: [],
  };
}

/** Marks an optimistic message as failed with a readable error. */
export function failMessage(list: readonly Message[], clientMessageId: string, message: string): Message[] {
  return list.map((m) => (m.clientMessageId === clientMessageId ? { ...m, status: "failed" as const, error: { message } } : m));
}

export function removeMessage(list: readonly Message[], clientMessageId: string): Message[] {
  return list.filter((m) => m.clientMessageId !== clientMessageId);
}

/** Sort key of the list: last activity, newest first. */
export function activityOf(c: Conversation): string {
  return c.lastMessageAt ?? c.createdAt;
}

/** Human text of a failed message's `error` ({ code?, message? }). */
export function deliveryErrorText(error: Message["error"]): string {
  const msg = error?.["message"];
  const code = error?.["code"];
  if (typeof msg === "string" && msg) return typeof code === "string" && code ? `${msg} (${code})` : msg;
  return "WhatsApp no aceptó el mensaje";
}

export const ATTACHMENT_LABELS: Record<Message["type"], string> = {
  text: "Texto",
  image: "Imagen",
  audio: "Audio",
  video: "Vídeo",
  document: "Documento",
  location: "Ubicación",
  template: "Plantilla",
  interactive: "Mensaje interactivo",
  unsupported: "Mensaje no compatible",
};
