import { ApiError } from "./api";

/** Spanish, user-facing text for an error. Never includes request data (e.g. passwords). */
export function errorMessage(err: unknown, context: "login" | "signup" | "generic" = "generic"): string {
  if (!(err instanceof ApiError)) return "Ocurrió un error inesperado. Inténtalo de nuevo.";
  switch (err.code) {
    case "UNAUTHORIZED":
      return context === "login" ? "Correo o contraseña incorrectos." : "Tu sesión ha caducado. Inicia sesión de nuevo.";
    case "CONFLICT":
      return "No se pudo completar el registro. Prueba con otro correo u otro identificador de empresa.";
    case "RATE_LIMITED":
      return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
    case "VALIDATION_ERROR":
      return "Revisa los datos introducidos.";
    case "FORBIDDEN":
      return "No tienes permiso para realizar esta acción.";
    case "NETWORK_ERROR":
      return "No se pudo conectar con el servidor. Comprueba tu conexión.";
    default:
      return "Ocurrió un error en el servidor. Inténtalo más tarde.";
  }
}

export const ENCRYPTION_KEYS_MISSING = "El servidor no tiene configuradas las claves de cifrado";

/** Errors of the channels and inbox screens. */
export function channelErrorMessage(err: unknown): string {
  if (isEncryptionNotConfigured(err)) return `${ENCRYPTION_KEYS_MISSING}. Avisa a quien administre el servidor.`;
  if (err instanceof ApiError && err.status === 409) return "Ya existe un canal con ese teléfono.";
  if (err instanceof ApiError && err.status === 400) return "Revisa los datos introducidos.";
  return errorMessage(err);
}

/** 503 ENCRYPTION_NOT_CONFIGURED; the bare 503 status is kept as a fallback (non-JSON proxy answer). */
export function isEncryptionNotConfigured(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.code === "ENCRYPTION_NOT_CONFIGURED" || err.status === 503);
}
