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
