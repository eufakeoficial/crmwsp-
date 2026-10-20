import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AppError, ErrorCode } from "@crmwsp/contracts";
import { InvalidSignatureError, isoExponent } from "@crmwsp/payments";
import type { WebhookHeaders } from "./types.js";

export { InvalidSignatureError };

/** Signature was valid but the body is not something we can normalize. 400. */
export class CommercePayloadError extends AppError {
  constructor(message = "Invalid commerce webhook payload") {
    super(ErrorCode.ValidationError, message, 400);
  }
}

export function header(headers: WebhookHeaders, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== wanted) continue;
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" ? s.trim() : undefined;
  }
  return undefined;
}

/** Constant-time comparison of two byte strings of possibly different length. */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * Compares two secrets in constant time by hashing both first (equal length, no length leak).
 */
export function safeEqualText(a: string | undefined | null, b: string): boolean {
  if (typeof a !== "string" || a.length === 0 || b.length === 0) return false;
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export function hmac(alg: "sha1" | "sha256", secret: string, body: Uint8Array): Buffer {
  return createHmac(alg, secret).update(body).digest();
}

/** Decodes `value` as hex of exactly `bytes` length, else null. */
export function fromHex(value: string | undefined, bytes: number): Buffer | null {
  if (!value || !new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(value)) return null;
  return Buffer.from(value, "hex");
}

export function fromBase64(value: string | undefined, bytes: number): Buffer | null {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const b = Buffer.from(value, "base64");
  return b.length === bytes ? b : null;
}

export function decode(rawBody: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(rawBody);
}

export function parseJsonObject(rawBody: Uint8Array): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(decode(rawBody));
  } catch {
    throw new CommercePayloadError("Body is not JSON");
  }
  if (!isObject(v)) throw new CommercePayloadError("Body is not a JSON object");
  return v;
}

export function parseForm(rawBody: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(decode(rawBody))) out[k] ??= v;
  return out;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function obj(v: unknown): Record<string, unknown> {
  return isObject(v) ? v : {};
}

/** Non-empty trimmed string (numbers are stringified), capped. */
export function str(v: unknown, max = 500): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export function currencyOf(v: unknown): string | null {
  const s = str(v, 10);
  if (!s) return null;
  const c = s.toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/**
 * Decimal major units ("49.90", 49.9, "1234") -> ISO minor units, exact (no float math).
 * Returns null on anything ambiguous (exponent notation, negative, too many decimals, too large).
 */
export function decimalToMinor(value: unknown, currency: string | null): number | null {
  if (!currency) return null;
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    s = String(value);
  } else if (typeof value === "string") s = value.trim();
  else return null;
  const m = /^(\d{1,15})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  let exp: number;
  try {
    exp = isoExponent(currency);
  } catch {
    return null;
  }
  const intPart = m[1] ?? "0";
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > exp) return null;
  const minor = Number(intPart + frac.padEnd(exp, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Integer minor units already (e.g. Gumroad `price` in cents). */
export function integerMinor(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{1,15}$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function dateOf(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Seconds or milliseconds since epoch.
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = str(v, 64);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function uuidOrNull(v: unknown): string | null {
  const s = str(v, 64);
  return s && UUID_RE.test(s) ? s.toLowerCase() : null;
}
