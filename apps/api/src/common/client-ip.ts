import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Real client IP behind Railway.
 *
 * Two ways in:
 *  - public path (browser -> Railway edge -> API): the edge appends the client to
 *    X-Forwarded-For, so we trust exactly TRUST_PROXY_HOPS (default 1) hops, same as
 *    Fastify's `trustProxy: <number>`.
 *  - web path (browser -> edge -> Next -> API): the Next middleware forwards the IP it saw in
 *    `x-crmwsp-client-ip`, signed with INTERNAL_PROXY_SECRET in `x-crmwsp-proxy-sig`
 *    (`t=<unix ms>,v=<hex hmac-sha256(secret, "<ip>|<t>")>`). It is honoured ONLY when the
 *    HMAC verifies and the timestamp is fresh; otherwise it is ignored (spoof attempt) and we
 *    fall back to the hop-count result.
 */
export const CLIENT_IP_HEADER = "x-crmwsp-client-ip";
export const PROXY_SIG_HEADER = "x-crmwsp-proxy-sig";
/** Max accepted age/skew of a signed forward. */
export const PROXY_SIG_MAX_SKEW_MS = 60_000;

const CACHE = Symbol("crmwsp.clientIp");

export interface ClientIpOptions {
  secret: string | undefined;
  hops: number;
  now?: number;
}

export function signClientIp(secret: string, ip: string, ts: number): string {
  return `t=${ts},v=${createHmac("sha256", secret).update(`${ip}|${ts}`).digest("hex")}`;
}

export function trustProxyHopsFromEnv(): number {
  const n = Number(process.env["TRUST_PROXY_HOPS"] ?? 1);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 1;
}

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

function verifiedForward(headers: IncomingMessage["headers"], secret: string | undefined, now: number): string | undefined {
  if (!secret) return undefined;
  const ip = single(headers[CLIENT_IP_HEADER])?.trim();
  const sig = single(headers[PROXY_SIG_HEADER]);
  if (!ip || !sig || !IP_RE.test(ip)) return undefined;
  const m = /^t=(\d{1,15}),v=([0-9a-f]{64})$/.exec(sig.trim());
  if (!m) return undefined;
  const ts = Number(m[1]);
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > PROXY_SIG_MAX_SKEW_MS) return undefined;
  const expected = Buffer.from(signClientIp(secret, ip, ts).slice(-64), "hex");
  const given = Buffer.from(m[2] as string, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected) ? ip : undefined;
}

/** proxy-addr semantics for a numeric hop count: [socket, ...XFF right-to-left][min(hops, n-1)]. */
function hopAddress(raw: IncomingMessage, hops: number): string {
  const socket = raw.socket?.remoteAddress ?? "";
  const xff = single(raw.headers["x-forwarded-for"]);
  const chain = [socket, ...(xff ? xff.split(",").map((s) => s.trim()).filter(Boolean).reverse() : [])];
  return chain[Math.min(hops, chain.length - 1)] ?? socket;
}

export function resolveClientIp(raw: IncomingMessage, opts: ClientIpOptions): string {
  const ip = verifiedForward(raw.headers, opts.secret, opts.now ?? Date.now()) ?? hopAddress(raw, opts.hops);
  return (ip.startsWith("::ffff:") ? ip.slice(7) : ip) || "unknown";
}

type WithRaw = { raw: IncomingMessage };
type Cached = IncomingMessage & { [CACHE]?: string };

/**
 * The single source of truth for "who is calling" (rate limits, audit, sessions). Accepts the
 * Fastify request (via `.raw`) or the raw IncomingMessage (Nest middleware).
 */
export function clientIp(req: IncomingMessage | { raw?: IncomingMessage; ip?: string }): string {
  if (!("socket" in req) && !req.raw) return req.ip || "unknown";
  const raw = ("raw" in req && req.raw ? req.raw : req) as Cached;
  const hit = raw[CACHE];
  if (hit) return hit;
  const ip = resolveClientIp(raw, { secret: process.env["INTERNAL_PROXY_SECRET"] || undefined, hops: trustProxyHopsFromEnv() });
  raw[CACHE] = ip;
  return ip;
}

interface HookableFastify {
  addHook(name: "onRequest", fn: (req: WithRaw, reply: unknown, done: () => void) => void): unknown;
}

/**
 * onRequest hook: resolves the client IP once and pins it as `request.ip` (own property shadowing
 * Fastify's getter), so every existing `req.ip` reader (audit rows, sessions) gets the real IP.
 */
export function installClientIpHook(instance: unknown): boolean {
  const f = instance as Partial<HookableFastify> | undefined;
  if (typeof f?.addHook !== "function") return false;
  f.addHook("onRequest", (req, _reply, done) => {
    const ip = clientIp(req);
    Object.defineProperty(req, "ip", { value: ip, configurable: true, enumerable: true });
    done();
  });
  return true;
}
