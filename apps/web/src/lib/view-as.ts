import type { MembershipRole } from "@crmwsp/contracts";

/** Read-only "view as": who the owner/admin is looking as. Kept per browser tab. */
export interface ViewAsTarget {
  tenantId: string;
  userId: string;
  name: string;
  role: MembershipRole;
}

const KEY = "crmwsp.viewAs";

/**
 * Mirror of `canViewAs` in @crmwsp/domain (the web does not depend on it): an owner may view as an
 * admin, agent or viewer; an admin only as an agent or viewer; never as oneself.
 */
export function canViewAsMember(actor: MembershipRole | undefined, target: { userId: string; role: MembershipRole }, myUserId: string): boolean {
  if (actor !== "owner" && actor !== "admin") return false;
  if (target.userId === myUserId) return false;
  if (target.role === "owner") return false;
  return !(target.role === "admin" && actor !== "owner");
}

export function readViewAs(tenantId: string | null): ViewAsTarget | null {
  if (!tenantId) return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ViewAsTarget>;
    if (v.tenantId !== tenantId || typeof v.userId !== "string" || typeof v.name !== "string" || typeof v.role !== "string") return null;
    return { tenantId: v.tenantId, userId: v.userId, name: v.name, role: v.role };
  } catch {
    return null;
  }
}

export function storeViewAs(target: ViewAsTarget | null): void {
  try {
    if (target === null) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(target));
  } catch {
    // Storage unavailable: view-as simply does not start.
  }
}
