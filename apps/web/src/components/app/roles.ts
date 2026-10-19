import type { MembershipRole } from "@crmwsp/contracts";

export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  agent: "Agente",
  viewer: "Lector",
};
