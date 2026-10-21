import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { LlmProviderError, UnsafeBaseUrlError } from "../errors.js";

/*
 * SSRF guard for user-supplied (BYOK) base URLs.
 *
 * Strategy: resolve the host with `dns.lookup({ all: true })` before EVERY request and
 * reject if ANY address is private/reserved (fail fast, clear error). The connection itself
 * goes through `createSafeFetch` (safe-fetch.ts), which re-checks inside the socket lookup and
 * connects to that vetted address, closing the DNS-rebinding window (CN-009).
 * Redirects are rejected and production is https-only.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0:0", 96], // IPv4-translated (SIIT): may reach embedded IPv4
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True if the literal IP is private, loopback, link-local, metadata or otherwise reserved. */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, "ipv4");
  if (v === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped / compatible addresses: check the embedded IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return blocked.check(mapped[1], "ipv4");
    if (/^::\d+\.\d+\.\d+\.\d+$/.test(lower)) return true; // deprecated IPv4-compatible
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexMapped?.[1] && hexMapped[2]) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, "ipv4");
    }
    return blocked.check(ip, "ipv6");
  }
  return true; // not an IP: caller error, fail closed
}

export type LookupFn = (hostname: string) => Promise<Array<{ address: string }>>;

export const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export interface SafeUrlOptions {
  /** Allows http and local/private hosts (dev only, e.g. a local Ollama). Ignored in production. */
  allowInsecureLocal?: boolean;
  /** Defaults to production unless NODE_ENV is explicitly "development" or "test". */
  production?: boolean;
  lookup?: LookupFn;
}

const LOCAL_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

function isProduction(opts: SafeUrlOptions): boolean {
  return opts.production ?? !isDevOrTestEnv();
}

/** Dev allowances require an explicit NODE_ENV; unset or unknown values count as production (CN-011). */
export function isDevOrTestEnv(env: string | undefined = process.env.NODE_ENV): boolean {
  return env === "development" || env === "test";
}

/** Synchronous checks on the URL itself (scheme, credentials, literal host). Returns the parsed URL. */
export function assertSafeBaseUrlSyntax(raw: string, opts: SafeUrlOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeBaseUrlError("invalid URL");
  }
  const insecureOk = opts.allowInsecureLocal === true && !isProduction(opts);
  if (url.protocol !== "https:" && !(insecureOk && url.protocol === "http:")) {
    throw new UnsafeBaseUrlError("only https is allowed");
  }
  if (url.username !== "" || url.password !== "") throw new UnsafeBaseUrlError("credentials in URL");
  if (url.search !== "" || url.hash !== "") throw new UnsafeBaseUrlError("query or fragment in base URL");
  if (insecureOk) return url;
  // Only the default https port: arbitrary ports would let a tenant probe non-HTTP services.
  if (url.port !== "" && url.port !== "443") throw new UnsafeBaseUrlError("non-standard port");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (LOCAL_NAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeBaseUrlError("local hostname");
  }
  if (isIP(host) !== 0 && isBlockedIp(host)) throw new UnsafeBaseUrlError("private or reserved address");
  return url;
}

/**
 * Full check: syntax + DNS resolution. Every resolved address must be public.
 * Call it before each connection (see strategy note above).
 */
export async function assertSafeBaseUrl(raw: string, opts: SafeUrlOptions = {}): Promise<URL> {
  const url = assertSafeBaseUrlSyntax(raw, opts);
  if (opts.allowInsecureLocal === true && !isProduction(opts)) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return url;
  let addrs: Array<{ address: string }>;
  try {
    addrs = await (opts.lookup ?? defaultLookup)(host);
  } catch {
    throw new LlmProviderErrorDns();
  }
  if (addrs.length === 0) throw new LlmProviderErrorDns();
  if (addrs.some((a) => isBlockedIp(a.address))) throw new UnsafeBaseUrlError("host resolves to a private or reserved address");
  return url;
}

class LlmProviderErrorDns extends LlmProviderError {
  constructor() {
    super("Could not resolve LLM host", true);
  }
}
