import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { defaultLookup, isBlockedIp, type LookupFn } from "./url-safety.js";

/*
 * SSRF-safe fetch for tenant-controlled hosts (CN-009).
 *
 * The DNS answer is vetted inside the socket's own `lookup`, so the connection goes to the exact
 * address that passed `isBlockedIp`: a rebinding answer (public at check time, internal at connect
 * time) is refused at connect time. Redirects are always rejected. Uses undici's own fetch +
 * dispatcher (the Node-bundled undici may differ in version from the package's dispatcher API).
 */

export class BlockedAddressError extends Error {
  readonly code = "EBLOCKEDADDRESS";
  constructor() {
    super("resolved to a private or reserved address");
    this.name = "BlockedAddressError";
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

export interface SafeFetchPolicy {
  /** Resolver (tests inject one). Defaults to `dns.lookup({ all: true })`. */
  lookup?: LookupFn;
  /** Dev only: skip the address check (e.g. a local Ollama). Never set this in production. */
  allowPrivate?: boolean;
}

/** Socket `lookup` that refuses when ANY resolved address is private/reserved. */
export function guardedLookup(policy: SafeFetchPolicy = {}) {
  const resolve = policy.lookup ?? defaultLookup;
  return (hostname: string, options: { all?: boolean } | number | undefined, cb: LookupCallback): void => {
    const literal = hostname.replace(/^\[|\]$/g, "");
    const pending: Promise<Array<{ address: string }>> =
      isIP(literal) !== 0 ? Promise.resolve([{ address: literal }]) : resolve(literal);
    pending.then(
      (addrs) => {
        if (addrs.length === 0) return cb(Object.assign(new Error("no addresses"), { code: "ENOTFOUND" }), "", 0);
        if (policy.allowPrivate !== true && addrs.some((a) => isBlockedIp(a.address))) return cb(new BlockedAddressError(), "", 0);
        const list: LookupAddress[] = addrs.map((a) => ({ address: a.address, family: isIP(a.address) === 6 ? 6 : 4 }));
        const all = typeof options === "object" && options?.all === true;
        if (all) return cb(null, list);
        const first = list[0] as LookupAddress;
        return cb(null, first.address, first.family);
      },
      (err: unknown) => cb(err as NodeJS.ErrnoException, "", 0),
    );
  };
}

/** Returns a `fetch` whose connections are pinned to vetted public addresses and never follow redirects. */
export function createSafeFetch(policy: SafeFetchPolicy = {}): typeof globalThis.fetch {
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(policy) as never } });
  return ((input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as never, { ...(init as object), redirect: "error", dispatcher } as never)) as unknown as typeof globalThis.fetch;
}

/** One-shot helper: `safeFetch(url, init, policy)`. Prefer `createSafeFetch` to reuse the connection pool. */
export function safeFetch(url: string | URL, init: RequestInit = {}, policy: SafeFetchPolicy = {}): Promise<Response> {
  return createSafeFetch(policy)(url, init);
}
