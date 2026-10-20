import type { MembershipRole } from "@crmwsp/contracts";

export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  agent: "Agente",
  viewer: "Lector",
};

/** Owner and admin manage channels; agents see the list only. */
export function canManageChannels(role: MembershipRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Owner and admin edit AI settings, knowledge and approvals. */
export function canManageAi(role: MembershipRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Agents see AI settings read-only; viewers get "Sin acceso". */
export function canViewAi(role: MembershipRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "agent";
}
