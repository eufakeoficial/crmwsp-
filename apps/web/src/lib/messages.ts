import { ApiError } from "./api";

/** Setup mode (ADR 0015): the tenant has no WhatsApp channel yet. */
export const SETUP_REQUIRED_TEXT = "Conecta tu WhatsApp para empezar tu prueba.";

export function isSetupRequired(err: unknown): boolean {
  return err instanceof ApiError && err.code === "SETUP_REQUIRED";
}

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
    case "SETUP_REQUIRED":
      return `${SETUP_REQUIRED_TEXT} Ve a Canales para conectarlo.`;
    case "PLAN_LIMIT_EXCEEDED":
      return planLimitMessage(err);
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

/** Reason of a 402 PLAN_LIMIT_EXCEEDED (`details.reason`), when the API sent one. */
export function planLimitReason(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== "PLAN_LIMIT_EXCEEDED") return null;
  const d = err.details;
  return d && typeof d === "object" && typeof (d as { reason?: unknown }).reason === "string" ? (d as { reason: string }).reason : null;
}

/** True for a 402 that only a payment fixes (lapsed subscription or a number that used its trial). */
export function isSubscriptionBlocked(err: unknown): boolean {
  const r = planLimitReason(err);
  return r === "subscription_restricted" || r === "trial_already_used";
}

function planLimitMessage(err: ApiError): string {
  switch (planLimitReason(err)) {
    case "subscription_restricted":
      return "Tu suscripción venció y la cuenta está en modo solo lectura. Renueva tu plan en Plan y uso para volver a crear y editar.";
    case "trial_already_used":
      return "Este número de WhatsApp ya usó su prueba gratis. Activa un plan en Plan y uso para continuar.";
    default: {
      const d = (err.details ?? {}) as { key?: unknown; requested?: unknown; remaining?: unknown; limit?: unknown; used?: unknown };
      const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const requested = num(d.requested);
      const limit = num(d.limit);
      if (d.key === "contacts" && requested !== null && limit !== null) {
        const remaining = num(d.remaining) ?? Math.max(0, limit - (num(d.used) ?? 0));
        return `El archivo agrega ${requested} ${requested === 1 ? "contacto nuevo" : "contactos nuevos"}, pero tu plan permite ${remaining} más (límite ${limit}). No se importó nada.`;
      }
      return "Tu plan no permite esta acción (límite alcanzado o suscripción vencida). Revisa Plan y uso.";
    }
  }
}
