import {
  LlmProviderError,
  OpenAICompatibleProvider,
  type LLMProvider,
  type LookupFn,
  type OpenAICompatibleProviderOptions,
} from "@crmwsp/ai";
import { DecryptionError, type CipherBox } from "@crmwsp/crypto";
import { isUuid, type Database, type LlmConnection } from "@crmwsp/db";
import { UnrecoverableError, type Queue } from "bullmq";
import type { LockRedis } from "./lock.js";
import { tenantChannel, type EventPublisher, type InboxEvent, type Logger } from "../processors.js";

/** AAD purpose of the encrypted BYOK LLM key (ADR 0008; same as the API's llm connections). */
export const LLM_API_KEY_PURPOSE = "llm_api_key";
/** Embedding model used when the connection does not name one in `capabilities.embeddingModel`. */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export type AiEventType = "ai.reply_drafted" | "ai.action_pending" | "ai.handoff" | "ai.budget_warning";

/** AI realtime events carry ids only (never message text). */
export interface AiEvent {
  type: AiEventType;
  conversationId?: string;
  actionId?: string;
  connectionId?: string;
  /** `YYYY-MM` for budget warnings. */
  month?: string;
}

export interface AiDeps {
  db: Database;
  publisher: EventPublisher;
  cipher: CipherBox;
  /** `outbound` queue, to hand AI replies to the existing send-message flow. */
  outboundQueue: Pick<Queue, "add">;
  /** Redis client for the per-conversation turn lock (see lock.ts). */
  lockRedis: LockRedis;
  logger?: Logger;
  /** Test seams: forwarded to OpenAICompatibleProvider. */
  fetch?: typeof globalThis.fetch;
  lookup?: LookupFn;
  /** Default embedding model when the connection does not configure one. */
  embeddingModel?: string;
  now?: () => Date;
}

export const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export function assertIds<K extends string>(data: unknown, keys: readonly K[]): Record<K, string> {
  const d = data as Record<string, unknown> | null;
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = d?.[k];
    if (!isUuid(v)) throw new UnrecoverableError("invalid job data");
    out[k] = v;
  }
  return out;
}

export async function publishEvents(deps: AiDeps, tenantId: string, events: Array<AiEvent | InboxEvent>): Promise<void> {
  for (const event of events) {
    try {
      await deps.publisher.publish(tenantChannel(tenantId), JSON.stringify(event));
    } catch (err) {
      // Realtime is best effort: the data is committed; the UI can refetch.
      (deps.logger ?? silent).warn(`publish failed (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
}

export function embeddingModelFor(deps: AiDeps, conn: LlmConnection): string {
  const configured = (conn.capabilities as { embeddingModel?: unknown }).embeddingModel;
  if (typeof configured === "string" && configured.trim() !== "") return configured.trim();
  return deps.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
}

/** Decrypts the tenant key (purpose `llm_api_key`, AAD = tenant) and builds the provider. */
export function buildProvider(deps: AiDeps, tenantId: string, conn: LlmConnection): LLMProvider {
  if (!conn.apiKeyEncrypted) throw new LlmProviderError("LLM connection has no API key", false);
  const apiKey = deps.cipher.decrypt(conn.apiKeyEncrypted, { tenantId, purpose: LLM_API_KEY_PURPOSE });
  const opts: OpenAICompatibleProviderOptions = { baseUrl: conn.baseUrl, apiKey };
  if (deps.fetch) opts.fetch = deps.fetch;
  if (deps.lookup) opts.lookup = deps.lookup;
  if (conn.capabilities.structuredOutput === false) opts.supportsJsonSchema = false;
  return new OpenAICompatibleProvider(opts);
}

export class InvalidModelOutputError extends Error {
  constructor() {
    super("model output invalid after retry with the strong model");
    this.name = "InvalidModelOutputError";
  }
}

/**
 * Provider failures that mean "the model answered but not in the contract" (see LlmProviderError).
 *
 * DEBT: `@crmwsp/ai` has no dedicated class/code for invalid output (it throws a plain
 * non-retryable LlmProviderError without status), so this matches the fixed messages of
 * openai-compatible.ts. Pinned by tests in ai.test.ts; replace with an `InvalidOutputError` (or an
 * error code) exported by `@crmwsp/ai` when it exists.
 */
export function isInvalidOutput(err: unknown): boolean {
  return (
    err instanceof LlmProviderError &&
    !err.retryable &&
    err.status === undefined &&
    /^(Model output|Model returned|Model refused|Unexpected chat response)/.test(err.message)
  );
}

export function isRetryableProviderError(err: unknown): boolean {
  return err instanceof LlmProviderError && err.retryable;
}

/**
 * Maps a failure to a sanitized, persistable handoff reason, or null when the error is not a
 * provider/credentials problem (DB errors etc. are rethrown so BullMQ retries them).
 * Never includes provider messages: they could echo request data.
 */
export function handoffReasonFor(err: unknown): string | null {
  if (err instanceof InvalidModelOutputError) return "invalid_output";
  if (err instanceof DecryptionError || (err as { name?: unknown } | null)?.name === "DecryptionError") {
    return "credentials_unavailable";
  }
  if (err instanceof LlmProviderError) {
    if (err.retryable) return "provider_unavailable";
    return err.status !== undefined ? `provider_error_${err.status}` : "provider_error";
  }
  return null;
}
