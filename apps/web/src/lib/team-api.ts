import {
  acceptInvitationResponseSchema,
  type AcceptInvitationRequest,
  type CreateInvitationRequest,
  invitationPreviewSchema,
  type MembershipRole,
  teamInvitationListSchema,
  teamInvitationSchema,
} from "@crmwsp/contracts";
import { ApiError, request } from "./api";

/** Team management (/team) and the public invitation flow (/invitations). */
export const teamApi = {
  invitations: () => request("/team/invitations", { schema: teamInvitationListSchema }),
  invite: (body: CreateInvitationRequest) => request("/team/invitations", { method: "POST", body, schema: teamInvitationSchema }),
  resend: (id: string) => request(`/team/invitations/${id}/resend`, { method: "POST", schema: teamInvitationSchema }),
  revoke: (id: string) => request(`/team/invitations/${id}`, { method: "DELETE" }),
  changeRole: (userId: string, role: MembershipRole) => request(`/team/members/${userId}`, { method: "PATCH", body: { role } }),
  remove: (userId: string) => request(`/team/members/${userId}`, { method: "DELETE" }),
  preview: (token: string) => request(`/invitations/${encodeURIComponent(token)}`, { schema: invitationPreviewSchema }),
  accept: (token: string, body: AcceptInvitationRequest = {}) =>
    request(`/invitations/${encodeURIComponent(token)}/accept`, { method: "POST", body, schema: acceptInvitationResponseSchema }),
};

/** Spanish messages for the team screens. */
export function teamErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Ocurrió un error inesperado. Inténtalo de nuevo.";
  switch (err.code) {
    case "PLAN_LIMIT_EXCEEDED":
      return "Tu plan no tiene más puestos disponibles. Mejora el plan o revoca una invitación pendiente.";
    case "CONFLICT":
      return "Ese correo ya es miembro o ya tiene una invitación pendiente.";
    case "FORBIDDEN":
      return "Tu rol no permite esta acción (los administradores no gestionan propietarios ni administradores, y siempre debe quedar un propietario).";
    case "NOT_FOUND":
      return "No se encontró el miembro o la invitación.";
    case "VALIDATION_ERROR":
      return "Revisa los datos introducidos.";
    case "RATE_LIMITED":
      return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
    default:
      return "Ocurrió un error en el servidor. Inténtalo más tarde.";
  }
}

export function acceptErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Ocurrió un error inesperado. Inténtalo de nuevo.";
  switch (err.code) {
    case "NOT_FOUND":
      return "La invitación no existe, ya se usó o ha caducado. Pide que te la reenvíen.";
    case "FORBIDDEN":
      return "Esta invitación se envió a otro correo. Inicia sesión con el correo invitado.";
    case "UNAUTHORIZED":
      return "Ya tienes una cuenta con este correo: inicia sesión para aceptar.";
    case "CONFLICT":
      return "Ya eres miembro de esta empresa.";
    case "RATE_LIMITED":
      return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
    case "VALIDATION_ERROR":
      return "Revisa los datos: la contraseña necesita al menos 10 caracteres.";
    default:
      return "Ocurrió un error en el servidor. Inténtalo más tarde.";
  }
}
