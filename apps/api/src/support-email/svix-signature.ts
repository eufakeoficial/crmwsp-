import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Svix webhook signature (used by Resend). Spec:
 * https://docs.svix.com/receiving/verifying-payloads/how-manual
 * signed content = `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 keyed with the base64
 * part of the secret after `whsec_`, compared against each `v1,<base64>` in `svix-signature`.
 */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type SvixVerdict = "ok" | "missing" | "stale" | "invalid";

function secretBytes(secret: string): Buffer | null {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length >= 16 ? buf : null;
}

export function signSvix(secret: string, id: string, timestamp: string, body: Buffer | string): string {
  const key = secretBytes(secret);
  if (!key) throw new Error("invalid svix secret");
  return createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest("base64");
}

export function verifySvixSignature(
  rawBody: Buffer,
  headers: SvixHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SvixVerdict {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || id.length > 256 || signature.length > 4096) return "missing";
  if (!/^\d{1,12}$/.test(timestamp)) return "invalid";
  if (Math.abs(nowSeconds - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return "stale";
  const key = secretBytes(secret);
  if (!key) return "invalid";
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(rawBody).digest();
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return "ok";
  }
  return "invalid";
}
