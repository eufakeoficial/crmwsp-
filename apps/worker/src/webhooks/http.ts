import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { WEBHOOK_TIMEOUT_MS, checkWebhookUrl, isPublicIp } from "@crmwsp/domain";

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** `statusCode` null = no HTTP response (network error, timeout, blocked address). */
export interface WebhookResponse {
  statusCode: number | null;
  error: string | null;
}

export type WebhookSender = (req: WebhookRequest) => Promise<WebhookResponse>;

type LookupFn = (hostname: string, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const defaultLookup: LookupFn = (hostname, cb) => dnsLookup(hostname, { all: true, verbatim: true }, cb);

export class BlockedAddressError extends Error {
  readonly code = "EBLOCKEDADDRESS";
  constructor() {
    super("resolved to a non-public address");
    this.name = "BlockedAddressError";
  }
}

/**
 * Socket `lookup` that resolves the host and refuses if ANY address is non-public. The socket then
 * connects to the vetted address itself, so DNS rebinding between check and connect is impossible.
 */
export function guardedLookup(resolve: LookupFn = defaultLookup) {
  return (
    hostname: string,
    options: { all?: boolean } | number | undefined,
    cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    resolve(hostname, (err, addresses) => {
      if (err) return cb(err, "", 0);
      if (addresses.length === 0 || addresses.some((a) => !isPublicIp(a.address))) return cb(new BlockedAddressError(), "", 0);
      const all = typeof options === "object" && options?.all;
      if (all) return cb(null, addresses);
      const first = addresses[0] as LookupAddress;
      return cb(null, first.address, first.family);
    });
  };
}

/**
 * POSTs with SSRF protection: static URL check, DNS-pinned public address, no redirects (Node http
 * never follows them; a 3xx counts as failure), hard timeout, response body discarded (max 64 KiB).
 * Errors are reduced to a code: never the URL query, headers or secret.
 */
export function createWebhookSender(opts: { allowHttp: boolean; lookup?: LookupFn; timeoutMs?: number }): WebhookSender {
  const lookup = guardedLookup(opts.lookup);
  const timeoutMs = opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  return (req) =>
    new Promise<WebhookResponse>((resolve) => {
      const check = checkWebhookUrl(req.url, { allowHttp: opts.allowHttp });
      if (!check.ok) return resolve({ statusCode: null, error: check.reason });
      const url = check.url;
      const mod = url.protocol === "https:" ? https : http;
      let settled = false;
      const done = (r: WebhookResponse): void => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const r = mod.request(
        url,
        {
          method: "POST",
          headers: { ...req.headers, "content-type": "application/json", "content-length": Buffer.byteLength(req.body).toString() },
          lookup: lookup as never,
          timeout: timeoutMs,
          agent: false,
        },
        (res) => {
          let read = 0;
          res.on("data", (chunk: Buffer) => {
            read += chunk.length;
            if (read > 64 * 1024) res.destroy();
          });
          res.on("end", () => done({ statusCode: res.statusCode ?? null, error: null }));
          res.on("close", () => done({ statusCode: res.statusCode ?? null, error: null }));
          res.on("error", () => done({ statusCode: res.statusCode ?? null, error: null }));
        },
      );
      r.on("timeout", () => {
        r.destroy();
        done({ statusCode: null, error: "timeout" });
      });
      r.on("error", (err: NodeJS.ErrnoException) => done({ statusCode: null, error: (err.code ?? err.name).slice(0, 60) }));
      r.end(req.body);
    });
}
