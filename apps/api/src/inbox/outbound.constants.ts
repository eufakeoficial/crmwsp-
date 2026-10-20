/** BullMQ queue consumed by apps/worker (keep in sync with apps/worker/src/queue.ts). */
export const OUTBOUND_QUEUE = Symbol("OUTBOUND_QUEUE");
export const SEND_MESSAGE_JOB = "send-message";
export const SEND_MESSAGE_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/** Queue name; overridable so tests can use an isolated queue. */
export function outboundQueueName(): string {
  return process.env["OUTBOUND_QUEUE_NAME"] ?? "outbound";
}

export interface SendMessageJobData {
  tenantId: string;
  messageId: string;
}

/** Emoji reaction job (keep in sync with apps/worker/src/queue.ts). Empty emoji removes the reaction. */
export const SEND_REACTION_JOB = "send-reaction";
export interface SendReactionJobData {
  tenantId: string;
  messageId: string;
  emoji: string;
}
