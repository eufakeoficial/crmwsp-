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

/** Owner and admin configure the agenda (resources, services, hours); the API enforces the same. */
export function canManageAgenda(role: MembershipRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Owner, admin and agent create, move and cancel bookings; viewers only look. */
export function canBook(role: MembershipRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "agent";
}

/** Owner and admin edit AI settings, knowledge and approvals. */
export function canManageAi(role: MembershipRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Agents see AI settings read-only; viewers get "Sin acceso". */
export function canViewAi(role: MembershipRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "agent";
}
