export type AiStatusTone = "green" | "amber" | "blue" | "gray";
export type AiStatusKind = "closed" | "handoff" | "assigned" | "off" | "assist" | "paused" | "active";

export interface AiStatusInput {
  aiMode: "off" | "assist" | "auto";
  /** Conversation status: "open" | "pending" (AI handed off) | "resolved". */
  status: string;
  inboxStatus?: "open" | "closed" | undefined;
  assigneeName: string | null;
  /** ISO timestamp; the AI is paused while it is in the future. */
  pausedUntil?: string | null;
}

export interface AiStatus {
  kind: AiStatusKind;
  tone: AiStatusTone;
  label: string;
  /** Tooltip with the reason. */
  reason: string;
  /** ISO pause end, only for kind "paused". */
  pausedUntil: string | null;
  canResume: boolean;
}

export const AI_CONDITIONS_HINT = "Para que responda sola: modo automático, sin persona asignada, chat abierto y sin pausa.";

export function isPausedAt(pausedUntil: string | null | undefined, now: Date): boolean {
  if (!pausedUntil) return false;
  const t = new Date(pausedUntil).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function build(kind: AiStatusKind, tone: AiStatusTone, label: string, reason: string, extra: Partial<AiStatus> = {}): AiStatus {
  return { kind, tone, label, reason, pausedUntil: null, canResume: false, ...extra };
}

export function computeAiStatus(input: AiStatusInput, now: Date = new Date()): AiStatus {
  const { aiMode, status, inboxStatus, assigneeName, pausedUntil } = input;
  if (inboxStatus === "closed" || status === "resolved") {
    return build("closed", "gray", "Chat cerrado", `La IA no responde en chats cerrados. ${AI_CONDITIONS_HINT}`);
  }
  if (status === "pending") {
    return build("handoff", "amber", "Necesita atención: la IA derivó a una persona", `La IA derivó este chat a una persona y no responde. ${AI_CONDITIONS_HINT}`);
  }
  if (assigneeName) {
    return build("assigned", "amber", `Atendido por ${assigneeName}: la IA no responde`, `Hay una persona asignada. ${AI_CONDITIONS_HINT}`);
  }
  if (aiMode === "off") return build("off", "gray", "IA apagada en este chat", `El modo de IA está apagado. ${AI_CONDITIONS_HINT}`);
  if (aiMode === "assist") {
    return build("assist", "blue", "IA asistente: redacta borradores, tú envías", `En modo asistente la IA no envía mensajes sola. ${AI_CONDITIONS_HINT}`);
  }
  if (isPausedAt(pausedUntil, now)) {
    const until = pausedUntil as string;
    return build("paused", "amber", `IA en pausa hasta ${formatClock(until)} (respondiste tú)`, `La IA se pausó para este cliente. ${AI_CONDITIONS_HINT}`, {
      pausedUntil: until,
      canResume: true,
    });
  }
  return build("active", "green", "IA activa: responde sola", "La IA responde sola a los mensajes de este cliente.");
}

/** Whether the AI is expected to auto-reply, from list data only (pause unknown). */
export function listAiTone(input: Omit<AiStatusInput, "pausedUntil">): { tone: AiStatusTone; label: string } {
  const s = computeAiStatus(input);
  return { tone: s.tone, label: s.label };
}
