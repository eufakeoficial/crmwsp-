import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Gupshup does not document any signature (HMAC or otherwise) on its callbacks,
 * so webhook authenticity relies on an unguessable per-connection token embedded
 * in the callback URL (`/webhooks/gupshup/:webhookToken`) plus strict payload validation.
 * 32 random bytes = 256 bits of entropy.
 */
export function generateWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time comparison. Both inputs are hashed first so the comparison
 * does not leak length information and `timingSafeEqual` always gets equal-size buffers.
 */
export function safeEqualToken(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
