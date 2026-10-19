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
