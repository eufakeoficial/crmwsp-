/** DI token: BullMQ queue "ai", consumed by apps/worker (keep names in sync with the worker). */
export const AI_QUEUE = Symbol("AI_QUEUE");

export const EXECUTE_AI_ACTION_JOB = "execute-ai-action";
export const EMBED_SOURCE_JOB = "embed-source";

export const AI_JOB_OPTIONS = {
  // Same as apps/worker/src/queue.ts AI_JOB_OPTIONS (3 attempts, 5 s exponential backoff).
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/** Queue name ("ai", same as AI_QUEUE_NAME in apps/worker/src/queue.ts; BullMQ job ids must not contain ":"); overridable so tests can use an isolated queue. */
export function aiQueueName(): string {
  return process.env["AI_QUEUE_NAME"] ?? "ai";
}

/** Payloads carry ids only: the worker reads everything else under withTenant. */
export interface ExecuteAiActionJobData {
  tenantId: string;
  actionId: string;
}

export interface EmbedSourceJobData {
  tenantId: string;
  sourceId: string;
}

/** AAD purpose of the encrypted LLM API key (ADR 0008). */
export const LLM_API_KEY_PURPOSE = "llm_api_key";

/** AAD purpose of the encrypted TTS (ElevenLabs) API key; same value in apps/worker. */
export const TTS_API_KEY_PURPOSE = "tts_api_key";

/** DI token: TTSProvider (ElevenLabs by default; tests swap it). */
export const TTS_PROVIDER = Symbol("TTS_PROVIDER");
