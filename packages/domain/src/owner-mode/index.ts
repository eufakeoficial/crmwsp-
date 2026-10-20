import { OWNER_MUTATING_INTENTS, type OwnerCommandInterpretation, type OwnerIntent } from "@crmwsp/contracts";

/* F9 "modo dueño": pure rules (no I/O). Hashing and persistence live in @crmwsp/db / the apps. */

export const OWNER_MODE_LIMITS = {
  /** Phone verification code lifetime. */
  codeTtlMs: 10 * 60 * 1000,
  /** Wrong codes allowed before the code is burned (a new one must be requested). */
  maxCodeAttempts: 5,
  /** Confirmation nonce lifetime for mutating commands. */
  nonceTtlMs: 5 * 60 * 1000,
  /** Owner commands per phone and window. */
  rateWindowMs: 10 * 60 * 1000,
  rateMax: 20,
} as const;

/** Only these membership roles may use owner mode. */
export const OWNER_MODE_ROLES = ["owner", "admin"] as const;

export function canUseOwnerMode(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isMutatingIntent(intent: OwnerIntent): boolean {
  return (OWNER_MUTATING_INTENTS as readonly string[]).includes(intent);
}

export function isRateLimited(commandsInWindow: number): boolean {
  return commandsInWindow >= OWNER_MODE_LIMITS.rateMax;
}

export type OwnerCodeCheck = "ok" | "wrong" | "expired" | "locked" | "no_code";

/** Decides a verification attempt; `matches` is the constant-time hash comparison done by the caller. */
export function checkOwnerCode(
  state: { codeHash: string | null; codeExpiresAt: Date | null; attempts: number },
  matches: boolean,
  now: Date,
): OwnerCodeCheck {
  if (!state.codeHash || !state.codeExpiresAt) return "no_code";
  if (state.attempts >= OWNER_MODE_LIMITS.maxCodeAttempts) return "locked";
  if (now.getTime() >= state.codeExpiresAt.getTime()) return "expired";
  return matches ? "ok" : "wrong";
}

export type OwnerReplyParse =
  | { kind: "confirm"; nonce: string }
  | { kind: "confirm_without_nonce" }
  | { kind: "cancel" }
  | { kind: "other" };

const CONFIRM_WORDS = "s[ií]|si|confirmo|confirmar|ok|dale";
const CONFIRM_RE = new RegExp(`^(?:${CONFIRM_WORDS})[\\s,.:!]*(\\d{6})[\\s.!]*$`, "iu");
const CONFIRM_BARE_RE = new RegExp(`^(?:${CONFIRM_WORDS})[\\s.!]*$`, "iu");
const CANCEL_RE = /^(?:no|cancelar|cancela|cancelo)(?:[\s,.:!]*\d{6})?[\s.!]*$/iu;

/** Recognises "sí 123456" / "Confirmo 123456" (confirmation with nonce) and "no" / "cancelar". */
export function parseOwnerReply(text: string): OwnerReplyParse {
  const t = text.trim();
  const m = CONFIRM_RE.exec(t);
  if (m?.[1]) return { kind: "confirm", nonce: m[1] };
  if (CONFIRM_BARE_RE.test(t)) return { kind: "confirm_without_nonce" };
  if (CANCEL_RE.test(t)) return { kind: "cancel" };
  return { kind: "other" };
}

const empty = (intent: OwnerIntent): OwnerCommandInterpretation => ({ intent, actionRef: null, query: null, replyText: null });

/**
 * Slash shortcuts (no LLM): /resumen, /presupuestos, /pendientes, /aprobar <ref>, /rechazar <ref>,
 * /ventas, /buscar <texto>, /responder <nombre>: <texto>, /pausar, /activar, /ayuda.
 * Returns null when the text is not a shortcut.
 */
export function parseOwnerShortcut(text: string): OwnerCommandInterpretation | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const [rawCmd = "", ...restParts] = t.slice(1).split(/\s+/u);
  const cmd = rawCmd.toLowerCase();
  const rest = restParts.join(" ").trim();
  switch (cmd) {
    case "resumen":
      return empty("daily_summary");
    case "presupuestos":
      return empty("pending_quotes");
    case "pendientes":
    case "acciones":
      return empty("pending_actions");
    case "aprobar":
      return { ...empty("approve_action"), actionRef: rest.slice(0, 64) || null };
    case "rechazar":
      return { ...empty("reject_action"), actionRef: rest.slice(0, 64) || null };
    case "ventas":
      return empty("sales_week");
    case "buscar":
      return { ...empty("search_contact"), query: rest.slice(0, 120) || null };
    case "responder": {
      const idx = rest.indexOf(":");
      if (idx <= 0) return { ...empty("draft_reply"), query: rest.slice(0, 120) || null };
      return {
        ...empty("draft_reply"),
        query: rest.slice(0, idx).trim().slice(0, 120) || null,
        replyText: rest.slice(idx + 1).trim().slice(0, 1000) || null,
      };
    }
    case "pausar":
      return empty("pause_ai");
    case "activar":
      return empty("resume_ai");
    case "ayuda":
    case "help":
      return empty("help");
    default:
      return empty("unknown");
  }
}

export const OWNER_HELP_TEXT = [
  "Modo dueño. Puedes escribir en lenguaje natural o usar atajos:",
  "/resumen — resumen del día",
  "/presupuestos — presupuestos pendientes",
  "/pendientes — acciones esperando aprobación",
  "/aprobar <ref> · /rechazar <ref>",
  "/ventas — ventas de los últimos 7 días",
  "/buscar <nombre o teléfono>",
  "/responder <cliente>: <mensaje>",
  "/pausar · /activar — IA de todo el negocio",
  "Las acciones que cambian algo siempre piden confirmación con un código.",
].join("\n");

/** Formats integer minor units for a WhatsApp text (no locale dependency). */
export function formatMinor(minor: bigint, currency: string): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const units = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${units.toString()}.${cents} ${currency}`;
}

/**
 * Customer-originated text shown to the owner LLM or echoed back is quoted as data: control
 * characters and quote marks are stripped and the length is capped, so it cannot close the quote.
 */
export function quoteAsData(text: string | null | undefined, max = 120): string {
  if (!text) return "«»";
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f«»"`]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max);
  return `«${clean}»`;
}
