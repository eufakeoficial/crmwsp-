import type { UserTenant } from "@crmwsp/contracts";

const KEY = "crmwsp.activeTenantId";
let memoryFallback: string | null = null;

export function readStoredTenantId(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

export function storeTenantId(id: string | null): void {
  memoryFallback = id;
  try {
    if (id === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, id);
  } catch {
    // Storage unavailable (private mode, blocked): the in-memory value is enough.
  }
}

/**
 * Picks the active tenant: the stored id only if it is still in `tenants`
 * (the server list is the source of truth); a single tenant is chosen
 * automatically; otherwise null (the user must choose).
 */
export function resolveActiveTenant(tenants: readonly UserTenant[], storedId: string | null): UserTenant | null {
  const stored = storedId === null ? undefined : tenants.find((t) => t.id === storedId);
  if (stored) return stored;
  if (tenants.length === 1) return tenants[0] ?? null;
  return null;
}
