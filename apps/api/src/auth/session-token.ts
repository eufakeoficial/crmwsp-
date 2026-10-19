import { createHash, randomBytes } from "node:crypto";
import type { HttpReply, HttpRequest } from "../common/http.js";

// __Host- prefix: browsers only accept it with Secure, Path=/ and no Domain,
// so a sibling subdomain cannot plant ("toss") a session cookie for us.
export const SESSION_COOKIE = "__Host-crmwsp_session";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_COOKIE_HEADER = 8192;

/** 32 random bytes, base64url (43 chars). Only its SHA-256 is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): Buffer {
  return createHash("sha256").update(Buffer.from(token, "base64url")).digest();
}

/**
 * Reads the session token from the Cookie header. Tolerates quoted values;
 * rejects oversized headers and ambiguous duplicates (two different values),
 * returning undefined (=> 401) instead of guessing.
 */
export function readSessionToken(req: HttpRequest): string | undefined {
  const raw = req.headers["cookie"];
  const header = Array.isArray(raw) ? raw.join("; ") : raw;
  if (!header || header.length > MAX_COOKIE_HEADER) return undefined;
  let found: string | undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!TOKEN_RE.test(value)) return undefined;
    if (found !== undefined && found !== value) return undefined;
    found = value;
  }
  return found;
}

export function setSessionCookie(reply: HttpReply, token: string, maxAgeSeconds: number): void {
  reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`,
  );
}

export function clearSessionCookie(reply: HttpReply): void {
  reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}
