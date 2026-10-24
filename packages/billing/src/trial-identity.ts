/**
 * Trial anti-abuse identities (ADR 0015, T7): one phone number (or WABA) gets one free trial for
 * life across all tenants. Only HMAC-SHA256 digests keyed with TRIAL_IDENTITY_SECRET are stored
 * (`trial_claims`), never the plaintext phone or WABA id.
 * Server-only (node:crypto): import from "@crmwsp/billing/trial-identity", never from the index,
 * which @crmwsp/contracts (and so the web bundle) imports.
 */
import { createHmac } from "node:crypto";

export const TRIAL_IDENTITY_TYPES = ["phone", "waba"] as const;
export type TrialIdentityType = (typeof TRIAL_IDENTITY_TYPES)[number];

/** Phones: digits only with a leading `+` (E.164 shape); other ids: trimmed. */
export function normalizeTrialIdentity(type: TrialIdentityType, value: string): string {
  const v = value.trim();
  if (type === "phone") {
    const digits = v.replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }
  return v;
}

export function trialIdentityHash(secret: string, type: TrialIdentityType, value: string): string {
  if (!secret || secret.length < 16) throw new RangeError("TRIAL_IDENTITY_SECRET must be at least 16 characters");
  const normalized = normalizeTrialIdentity(type, value);
  if (!normalized) throw new RangeError("empty trial identity");
  return createHmac("sha256", secret).update(`${type}:${normalized}`).digest("hex");
}
