import type { MeResponse } from "@crmwsp/contracts";
import { setActiveTenantId } from "./api";
import { readStoredTenantId, resolveActiveTenant, storeTenantId } from "./tenant";

/** Route to take after login/signup; sets the active tenant when it is unambiguous. */
export function routeAfterAuth(me: MeResponse): string {
  const active = resolveActiveTenant(me.tenants, readStoredTenantId());
  if (!active) return me.tenants.length > 1 ? "/select-tenant" : "/login";
  setActiveTenantId(active.id);
  storeTenantId(active.id);
  return "/app/inbox";
}

// Control chars (raw or percent-encoded) and backslashes: browsers strip/normalize them, so
// "/\t/evil.com" or "/%09/evil.com" can turn into a protocol-relative "//evil.com" (CN-014).
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001F\u007F\\]/;
const NEXT_BASE = "https://next.invalid";

function decodedOrNull(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Only same-origin absolute paths are honored as `next` (no `//host`, no schemes). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  const decoded = decodedOrNull(next);
  if (decoded === null || UNSAFE_CHARS.test(next) || UNSAFE_CHARS.test(decoded) || decoded.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(next, NEXT_BASE);
  } catch {
    return null;
  }
  if (url.origin !== NEXT_BASE) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Final post-login destination: an explicit safe `next` wins; platform admins land on the
 * backoffice; everyone else follows routeAfterAuth.
 */
export function postAuthDestination(defaultRoute: string, opts: { next?: string | null; isPlatformAdmin: boolean }): string {
  const next = safeNextPath(opts.next);
  if (next) return next;
  if (opts.isPlatformAdmin) return "/app/admin";
  return defaultRoute;
}
