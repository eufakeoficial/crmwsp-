import type { AiRunMode, AiRunOutcome } from "@crmwsp/contracts";
import type { Tone } from "@/components/ui";

export const OUTCOME_LABELS: Readonly<Record<AiRunOutcome, string>> = {
  sent: "Enviada",
  draft: "Borrador",
  handoff: "Derivada",
  blocked: "Bloqueada",
  error: "Error",
};

export const OUTCOME_TONES: Readonly<Record<AiRunOutcome, Tone>> = {
  sent: "success",
  draft: "info",
  handoff: "warning",
  blocked: "amber",
  error: "danger",
};

export const MODE_LABELS: Readonly<Record<AiRunMode, string>> = { auto: "Automático", draft: "Borrador" };

const REASON_LABELS: Readonly<Record<string, string>> = {
  budget_exceeded: "Presupuesto de IA agotado",
  plan_limit_reached: "Límite del plan alcanzado",
  invalid_output: "Respuesta inválida del modelo",
  credentials_unavailable: "Credenciales no disponibles",
  provider_unavailable: "Proveedor de IA no disponible",
  provider_error: "Error del proveedor de IA",
};

/** Spanish text for a handoff/run reason code; policy reasons without a translation are shown as stored. */
export function reasonLabel(reason: string | null): string {
  if (!reason) return "Sin motivo registrado";
  const known = REASON_LABELS[reason];
  if (known) return known;
  if (reason.startsWith("provider_error_")) return `Error del proveedor de IA (${reason.slice("provider_error_".length)})`;
  return reason;
}

/** "5 min", "2 h 10 min", "3 d" since `since`. */
export function waitingLabel(since: string | Date, now: Date = new Date()): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d`;
}
