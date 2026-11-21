/** Email verification links live 24 hours (mirrored by email_verification_issue, migration 0095). */
export const EMAIL_VERIFICATION_TTL_HOURS = 24;
export const EMAIL_VERIFICATION_TTL_SECONDS = EMAIL_VERIFICATION_TTL_HOURS * 60 * 60;
/** Verification email resends per user: 3 per hour. */
export const EMAIL_VERIFICATION_RESEND_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 } as const;

export type EmailVerificationTokenState = "valid" | "expired" | "used";

/** State of a stored verification token: single use, invalid from `expiresAt` on. */
export function emailVerificationTokenState(token: { expiresAt: Date; usedAt: Date | null }, now: Date): EmailVerificationTokenState {
  if (token.usedAt) return "used";
  return now.getTime() < token.expiresAt.getTime() ? "valid" : "expired";
}

/** Product rule: a tenant connects a WhatsApp channel only once its owner's email is verified. */
export function emailAllowsWhatsAppConnect(input: { ownerEmailVerified: boolean }): boolean {
  return input.ownerEmailVerified;
}
