/**
 * Outbound webhook + public API rules (pure; no I/O). HMAC computation and DNS resolution live in
 * the adapters; these functions decide what is allowed and when to retry.
 */

export const API_KEY_PREFIX = "crm_live_";
/** Visible, non-secret part shown in the UI: prefix + first 8 chars of the random body. */
export const API_KEY_DISPLAY_LENGTH = API_KEY_PREFIX.length + 8;
const API_KEY_RE = /^crm_live_[A-Za-z0-9_-]{43}$/;

/** Shape check before hashing (cheap reject of garbage bearer tokens). */
export function isWellFormedApiKey(key: string): boolean {
  return API_KEY_RE.test(key);
}

export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, API_KEY_DISPLAY_LENGTH);
}

/** Parses `Authorization: Bearer <key>`; null when absent or malformed. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const key = m?.[1];
  return key && isWellFormedApiKey(key) ? key : null;
}

// ---- Delivery policy ----

export const WEBHOOK_MAX_ATTEMPTS = 8;
/** Endpoint auto-disables after this many consecutive failed attempts (across events). */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 20;
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Max age of a signature the receiver should accept (documented for integrators). */
export const WEBHOOK_SIGNATURE_TOLERANCE_S = 300;

/** Exponential backoff: 30s, 1m, 2m, 4m ... capped at 6h. `attempt` is the attempt that just failed (1-based). */
export function webhookBackoffMs(attempt: number): number {
  const base = 30_000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(base, 6 * 60 * 60 * 1000);
}

export type DeliveryOutcome =
  | { kind: "delivered" }
  | { kind: "retry"; nextAttemptAt: Date }
  | { kind: "failed" };

/** 2xx = delivered. Everything else (incl. network errors) retries until WEBHOOK_MAX_ATTEMPTS. */
export function decideDeliveryOutcome(attempt: number, statusCode: number | null, now: Date): DeliveryOutcome {
  if (statusCode !== null && statusCode >= 200 && statusCode < 300) return { kind: "delivered" };
  if (attempt >= WEBHOOK_MAX_ATTEMPTS) return { kind: "failed" };
  return { kind: "retry", nextAttemptAt: new Date(now.getTime() + webhookBackoffMs(attempt)) };
}

export function shouldAutoDisable(consecutiveFailures: number): boolean {
  return consecutiveFailures >= WEBHOOK_DISABLE_AFTER_FAILURES;
}

/** Signed content: `${timestamp}.${rawBody}` (Stripe-style, prevents replay with a stale timestamp). */
export function webhookSignedContent(timestampS: number, body: string): string {
  return `${timestampS}.${body}`;
}

export function formatSignatureHeader(timestampS: number, hexHmac: string): string {
  return `t=${timestampS},v1=${hexHmac}`;
}

// ---- SSRF guard ----

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback", "metadata.google.internal"]);

/**
 * Static URL check at registration and before every delivery. `allowHttp` only outside production.
 * Hostnames are additionally resolved and every address checked with `isPublicIp` at delivery.
 */
export function checkWebhookUrl(raw: string, opts: { allowHttp: boolean }): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) return { ok: false, reason: "https_required" };
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return { ok: false, reason: "invalid_url" };
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "private_host" };
  }
  if (isIpLiteral(host) && !isPublicIp(host)) return { ok: false, reason: "private_host" };
  if (url.port && !["443", "80", "8443", "8080"].includes(url.port)) return { ok: false, reason: "port_not_allowed" };
  return { ok: true, url };
}

export function isIpLiteral(host: string): boolean {
  return parseIpv4(host) !== null || host.includes(":");
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

function isPublicIpv4([a, b, c]: number[]): boolean {
  if (a === undefined || b === undefined || c === undefined) return false;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; // multicast + reserved + broadcast
  return true;
}

/** True only for globally routable unicast addresses (IPv4 or IPv6). Unparseable = not public. */
export function isPublicIp(ip: string): boolean {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(host);
  if (v4) return isPublicIpv4(v4);
  if (!host.includes(":")) return false;
  // IPv4-mapped / compatible (::ffff:a.b.c.d)
  const mapped = /^(?:0*:)*:?(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped?.[1]) {
    const m = parseIpv4(mapped[1]);
    return m ? isPublicIpv4(m) : false;
  }
  const hextets = expandIpv6(host);
  if (!hextets) return false;
  const first = hextets[0] ?? 0;
  if (hextets.every((h) => h === 0)) return false; // ::
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return false; // ::1
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    const [h6 = 0, h7 = 0] = [hextets[6], hextets[7]];
    return isPublicIpv4([h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff]);
  }
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && hextets[1] === 0x0db8) return false; // documentation
  if (first === 0x64 && hextets[1] === 0xff9b) return false; // NAT64 can reach internal v4
  return (first & 0xe000) === 0x2000; // only global unicast 2000::/3
}

function expandIpv6(host: string): number[] | null {
  const zoneless = host.split("%")[0] ?? "";
  const halves = zoneless.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const p of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };
  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/** CipherBox AAD purpose of the endpoint signing secret (tenant-bound). */
export const WEBHOOK_SECRET_PURPOSE = "webhook_endpoint_secret";
