import { createHmac, timingSafeEqual } from "node:crypto";
import { InvalidSignatureError } from "../errors.js";

export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Verifies a `Stripe-Signature` header (`t=<unix>,v1=<hex>[,v1=<hex>...]`):
 * HMAC-SHA256(secret, `${t}.${rawBody}`), constant-time comparison, any v1 may match,
 * |now - t| must be within the tolerance. Throws InvalidSignatureError with a generic message.
 */
export function verifyStripeSignature(params: {
  rawBody: Uint8Array;
  header: string | undefined;
  secret: string;
  nowMs: number;
  toleranceSeconds?: number;
}): void {
  const tolerance = params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const header = params.header;
  if (!header) throw new InvalidSignatureError();

  let timestamp: string | undefined;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") timestamp ??= v;
    else if (k === "v1") candidates.push(v);
  }
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || candidates.length === 0) throw new InvalidSignatureError();

  const expected = createHmac("sha256", params.secret).update(`${timestamp}.`).update(params.rawBody).digest();
  let ok = false;
  for (const c of candidates) {
    if (!/^[0-9a-fA-F]{64}$/.test(c)) continue;
    // Evaluate every candidate (no early exit) to keep timing independent of position.
    if (timingSafeEqual(expected, Buffer.from(c, "hex"))) ok = true;
  }
  if (!ok) throw new InvalidSignatureError();
  if (Math.abs(params.nowMs / 1000 - Number(timestamp)) > tolerance) {
    throw new InvalidSignatureError("Webhook timestamp outside tolerance");
  }
}
