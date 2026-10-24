/** BullMQ queue consumed by apps/worker (keep in sync with apps/worker/src/queue.ts). */
export const INBOUND_QUEUE_NAME = "inbound";
export const INGEST_MESSAGE_JOB = "ingest-message";
export const INGEST_STATUS_JOB = "ingest-status";
/** Meta account/number/template event (ADR 0021); keep in sync with apps/worker/src/queue.ts. */
export const INGEST_ACCOUNT_JOB = "ingest-account";

export interface InboundJobData {
  eventId: string;
  tenantId: string;
}

/** DI tokens. Explicit tokens (no reflection) so the module also works under esbuild/vitest. */
export const INBOUND_QUEUE = Symbol("INBOUND_QUEUE");
export const INBOUND_EVENT_STORE = Symbol("INBOUND_EVENT_STORE");
export const WEBHOOK_RATE_LIMITER = Symbol("WEBHOOK_RATE_LIMITER");
export const WHATSAPP_PROVIDER = Symbol("WHATSAPP_PROVIDER");

/** Max accepted webhook body (1 MiB, same cap as ingest_inbound_event). */
export const WEBHOOK_BODY_LIMIT = 1024 * 1024;

/** Tokens come from generateWebhookToken(): 32 random bytes as base64url (43 chars). */
export const WEBHOOK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedWebhookToken(token: unknown): token is string {
  return typeof token === "string" && WEBHOOK_TOKEN_RE.test(token);
}

/** Only a short prefix is ever logged. */
export function tokenPrefix(token: string): string {
  return `${token.slice(0, 6)}…`;
}
