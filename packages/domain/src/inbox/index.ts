/** Inbox v2 rules (T23): reminders, round-robin assignment, automation pause, contact timezone. */

export const REMINDER_PRESETS = ["20m", "1h", "6h", "12h", "custom"] as const;
export type ReminderPreset = (typeof REMINDER_PRESETS)[number];

const PRESET_MS: Record<Exclude<ReminderPreset, "custom">, number> = {
  "20m": 20 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
};

/** Max horizon of a custom reminder. */
export const REMINDER_MAX_AHEAD_MS = 365 * 24 * 60 * 60_000;

export type ReminderTimeResult = { ok: true; remindAt: Date } | { ok: false; reason: "custom_required" | "in_past" | "too_far" };

/** Resolves the instant of a reminder from a preset (or a custom instant, which must be in the future). */
export function reminderTime(preset: ReminderPreset, now: Date, custom?: Date | null): ReminderTimeResult {
  if (preset !== "custom") return { ok: true, remindAt: new Date(now.getTime() + PRESET_MS[preset]) };
  if (!custom) return { ok: false, reason: "custom_required" };
  if (custom.getTime() <= now.getTime()) return { ok: false, reason: "in_past" };
  if (custom.getTime() - now.getTime() > REMINDER_MAX_AHEAD_MS) return { ok: false, reason: "too_far" };
  return { ok: true, remindAt: custom };
}

export interface AssignmentCandidate {
  userId: string;
  /** Open (inbox) conversations currently assigned to the user. */
  openCount: number;
  /** Last time a conversation was assigned to the user (null = never). */
  lastAssignedAt: Date | null;
}

/**
 * Basic round robin: the least loaded agent below the cap; ties go to whoever waited longest
 * since the last assignment (never assigned first), then by id for determinism.
 */
export function pickRoundRobinAssignee(candidates: AssignmentCandidate[], maxOpenPerAgent: number | null): string | null {
  const eligible = candidates.filter((c) => maxOpenPerAgent === null || c.openCount < maxOpenPerAgent);
  if (eligible.length === 0) return null;
  const sorted = [...eligible].sort((a, b) => {
    if (a.openCount !== b.openCount) return a.openCount - b.openCount;
    const ta = a.lastAssignedAt?.getTime() ?? -Infinity;
    const tb = b.lastAssignedAt?.getTime() ?? -Infinity;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  return sorted[0]?.userId ?? null;
}

/** True while the contact's automations (AI turns, follow-ups) are paused. */
export function automationsPaused(pausedUntil: Date | null | undefined, now: Date): boolean {
  return pausedUntil != null && pausedUntil.getTime() > now.getTime();
}

/**
 * New pause instant after a human agent replies: extends (never shortens) an existing pause.
 * `minutes` = 0 disables the automatic pause.
 */
export function pauseAfterAgentReply(current: Date | null | undefined, now: Date, minutes: number): Date | null {
  if (minutes <= 0) return current ?? null;
  const next = new Date(now.getTime() + minutes * 60_000);
  return current && current.getTime() > next.getTime() ? current : next;
}

/**
 * Country calling code → (ISO country, IANA timezone). Only countries with a single timezone
 * (or a clearly dominant one) are mapped; multi-zone countries (US, CA, BR, MX…) return a
 * country without timezone.
 */
const CALLING_CODES: Array<[string, string, string | null]> = [
  ["591", "BO", "America/La_Paz"],
  ["593", "EC", "America/Guayaquil"],
  ["595", "PY", "America/Asuncion"],
  ["598", "UY", "America/Montevideo"],
  ["502", "GT", "America/Guatemala"],
  ["503", "SV", "America/El_Salvador"],
  ["504", "HN", "America/Tegucigalpa"],
  ["505", "NI", "America/Managua"],
  ["506", "CR", "America/Costa_Rica"],
  ["507", "PA", "America/Panama"],
  ["351", "PT", "Europe/Lisbon"],
  ["54", "AR", "America/Argentina/Buenos_Aires"],
  ["56", "CL", "America/Santiago"],
  ["57", "CO", "America/Bogota"],
  ["58", "VE", "America/Caracas"],
  ["51", "PE", "America/Lima"],
  ["52", "MX", null],
  ["55", "BR", null],
  ["53", "CU", "America/Havana"],
  ["34", "ES", "Europe/Madrid"],
  ["39", "IT", "Europe/Rome"],
  ["33", "FR", "Europe/Paris"],
  ["49", "DE", "Europe/Berlin"],
  ["44", "GB", "Europe/London"],
  ["1", "US", null],
];

export interface PhoneRegion {
  country: string | null;
  timezone: string | null;
}

/** Best-effort country/timezone of an E.164 number (longest calling-code prefix wins). */
export function regionForPhone(e164: string): PhoneRegion {
  const digits = e164.startsWith("+") ? e164.slice(1) : e164;
  if (!/^\d{6,15}$/.test(digits)) return { country: null, timezone: null };
  for (const [code, country, timezone] of CALLING_CODES) {
    if (digits.startsWith(code)) return { country, timezone };
  }
  return { country: null, timezone: null };
}
export * from "./citations.js";
