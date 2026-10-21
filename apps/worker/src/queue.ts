import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const INBOUND_QUEUE_NAME = "inbound";
export const INGEST_MESSAGE_JOB = "ingest-message";
export const INGEST_STATUS_JOB = "ingest-status";

export interface InboundJobData {
  eventId: string;
  tenantId: string;
}

export function createRedis(redisUrl: string): Redis {
  // BullMQ requires maxRetriesPerRequest = null on worker connections.
  return new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
}

// BullMQ 6 needs an explicit ioredis client under native ESM; lazyConnect keeps
// construction side-effect free until the queue issues its first command.
export function createInboundQueue(redisUrl: string, name: string = INBOUND_QUEUE_NAME): Queue {
  return new Queue(name, { connection: createRedis(redisUrl) });
}

/** Outbound sends (keep in sync with apps/api/src/inbox/outbound.constants.ts). */
export const OUTBOUND_QUEUE_NAME = "outbound";
export const SEND_MESSAGE_JOB = "send-message";
export const SEND_MESSAGE_MAX_ATTEMPTS = 5;

export interface SendMessageJobData {
  tenantId: string;
  messageId: string;
}

/** Outbound job options (keep in sync with apps/api/src/inbox/outbound.constants.ts). */
export const SEND_MESSAGE_JOB_OPTIONS = {
  attempts: SEND_MESSAGE_MAX_ATTEMPTS,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/** Emoji reaction to an inbound message, sent through the outbound queue. */
export const SEND_REACTION_JOB = "send-reaction";
export interface SendReactionJobData {
  tenantId: string;
  messageId: string;
  /** Empty string removes the reaction. */
  emoji: string;
}
/** One reaction per message: a replayed enqueue collapses into the same job. */
export const sendReactionJobId = (messageId: string): string => `send-reaction-${messageId}`;

/** AI queue (embeddings, AI turns, approved-action execution). Payloads carry ids only. */
export const AI_QUEUE_NAME = "ai";
export const EMBED_SOURCE_JOB = "embed-source";
export const AI_TURN_JOB = "ai-turn";
export const EXECUTE_AI_ACTION_JOB = "execute-ai-action";
/** Total attempts (first run included) for provider/transient failures of an AI turn. */
export const AI_TURN_MAX_ATTEMPTS = 3;
export const AI_JOB_OPTIONS = {
  attempts: AI_TURN_MAX_ATTEMPTS,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/**
 * BullMQ rejects custom job ids that contain ':' (unless they have exactly 3 parts), so the
 * ticket's `ai-turn:<id>` is spelled `ai-turn-<id>`. Producers (API) must use this helper's format.
 */
export const aiTurnJobId = (triggerMessageId: string): string => `ai-turn-${triggerMessageId}`;

export interface EmbedSourceJobData {
  tenantId: string;
  sourceId: string;
}
export interface AiTurnJobData {
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
}
export interface ExecuteAiActionJobData {
  tenantId: string;
  actionId: string;
}
