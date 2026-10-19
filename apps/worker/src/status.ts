import type { MessageStatus } from "@crmwsp/db";

/**
 * Delivery statuses only move forward: queued < sent < delivered < read.
 * `failed` wins over anything except `read` (and an existing `failed`).
 * Returns the statuses from which a message may transition to `next`.
 */
export function previousStatusesFor(next: MessageStatus): MessageStatus[] {
  switch (next) {
    case "sent":
      return ["queued"];
    case "delivered":
      return ["queued", "sent"];
    case "read":
      return ["queued", "sent", "delivered"];
    case "failed":
      return ["queued", "sent", "delivered"];
    default:
      return [];
  }
}

export function canAdvance(current: MessageStatus, next: MessageStatus): boolean {
  return previousStatusesFor(next).includes(current);
}
