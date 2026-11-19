import { AppError, ErrorCode } from "@crmwsp/contracts";

/**
 * Error raised by LLM providers. Uses its own class (instead of widening the
 * `ExternalProvider` union in contracts) because BYOK targets arbitrary
 * OpenAI-compatible vendors. Never carries the API key, request body or `cause`.
 */
/** Why a provider call failed when it is actionable by the tenant (their own key has no balance/quota left). */
export type LlmFailureReason = "insufficient_quota";

export class LlmProviderError extends AppError {
  readonly provider = "llm" as const;
  readonly retryable: boolean;
  readonly status?: number;
  readonly reason?: LlmFailureReason;

  constructor(message: string, retryable: boolean, status?: number, reason?: LlmFailureReason) {
    super(ErrorCode.ExternalProvider, message, 502, status === undefined ? {} : { details: { status } });
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
    if (reason !== undefined) this.reason = reason;
  }
}

/** Raised when a base URL fails the SSRF policy. Not retryable. */
export class UnsafeBaseUrlError extends LlmProviderError {
  constructor(reason: string) {
    super(`Unsafe LLM base URL: ${reason}`, false);
  }
}

/** HTTP 400 whose body says `response_format`/`json_schema` is unsupported. Triggers the json_object fallback. */
export class ResponseFormatUnsupportedError extends LlmProviderError {
  constructor() {
    super("LLM provider does not support json_schema response_format", false, 400);
  }
}
