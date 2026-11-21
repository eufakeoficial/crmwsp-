import type { MembershipRole } from "@crmwsp/contracts";

/** ADR 0022: only the tenant owner may reveal a channel API key (the API enforces the same). */
export function canRevealApiKey(role: MembershipRole | undefined): boolean {
  return role === "owner";
}

export const REVEAL_TOO_MANY_TEXT = "Demasiados intentos. Prueba en una hora.";
export const REVEAL_WRONG_PASSWORD_TEXT = "La contraseña no es correcta.";
export const REVEAL_GENERIC_ERROR_TEXT = "No se pudo mostrar la API key. Inténtalo de nuevo.";

/** Neutral Spanish message for a failed reveal, by HTTP status (never echoes server details). */
export function revealErrorMessage(err: unknown): string {
  const status = typeof err === "object" && err !== null && "status" in err ? (err as { status: unknown }).status : undefined;
  if (status === 429) return REVEAL_TOO_MANY_TEXT;
  if (status === 403) return REVEAL_WRONG_PASSWORD_TEXT;
  return REVEAL_GENERIC_ERROR_TEXT;
}

/** Seconds left until `expiresAt` (ms epoch), never negative, rounded up. */
export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function countdownLabel(seconds: number): string {
  return seconds === 1 ? "Se ocultará en 1 segundo" : `Se ocultará en ${seconds} segundos`;
}
