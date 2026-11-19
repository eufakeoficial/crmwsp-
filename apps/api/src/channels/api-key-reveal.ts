import { ForbiddenError, RateLimitedError, REVEALED_API_KEY_TTL_SECONDS, type RevealChannelApiKeyResponse } from "@crmwsp/contracts";

/** ADR 0022: at most 5 reveal attempts (failed AND successful) per user and tenant per hour. */
export const REVEAL_API_KEY_LIMIT = 5;
export const REVEAL_API_KEY_WINDOW_MS = 60 * 60 * 1000;

/** Generic on purpose: never tells whether the password, the account or anything else was wrong. */
export const REVEAL_DENIED_MESSAGE = "No pudimos confirmar tu identidad.";

export type RevealFailureReason = "rate_limited" | "wrong_password";

export interface RevealDeps {
  /** Counts one attempt for `key`; false when over the limit. */
  hit(key: string): Promise<boolean>;
  /** Password hash of the given user, or undefined (no password / unknown). */
  loadPasswordHash(userId: string, email: string): Promise<string | undefined>;
  /** Hash checked when the user has none, so timing does not reveal it. */
  dummyHash(): Promise<string>;
  verifyPassword(stored: string, password: string): Promise<boolean>;
  /** Decrypts the stored key (tenant-bound AAD). */
  decrypt(): string;
  auditFailure(reason: RevealFailureReason): Promise<void>;
  auditSuccess(): Promise<void>;
}

export interface RevealInput {
  tenantId: string;
  userId: string;
  email: string;
  password: string;
}

export function revealRateLimitKey(tenantId: string, userId: string): string {
  return `channel-key-reveal:${tenantId}:${userId}`;
}

/**
 * Owner re-authentication + rate limit + decrypt. Every call (ok or not) consumes one attempt.
 * The password and the key never leave this function except the key in the return value.
 */
export async function revealApiKey(deps: RevealDeps, input: RevealInput): Promise<RevealChannelApiKeyResponse> {
  if (!(await deps.hit(revealRateLimitKey(input.tenantId, input.userId)))) {
    await deps.auditFailure("rate_limited");
    throw new RateLimitedError("Demasiados intentos. Prueba en una hora.");
  }
  const stored = await deps.loadPasswordHash(input.userId, input.email);
  const ok = await deps.verifyPassword(stored ?? (await deps.dummyHash()), input.password);
  if (!stored || !ok) {
    await deps.auditFailure("wrong_password");
    throw new ForbiddenError(REVEAL_DENIED_MESSAGE);
  }
  const apiKey = deps.decrypt();
  await deps.auditSuccess();
  return { apiKey, expiresInSeconds: REVEALED_API_KEY_TTL_SECONDS };
}
