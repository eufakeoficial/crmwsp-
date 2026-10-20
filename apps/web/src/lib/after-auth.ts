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

/** Only same-origin absolute paths are honored as `next` (no `//host`, no schemes). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
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
