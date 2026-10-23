import { siteAssistantResponseSchema, type SiteAssistantMessage, type SiteAssistantResponse } from "@crmwsp/contracts";
import { ApiError, request } from "./api";

/** Window event any CTA can dispatch to open the landing assistant (see openSiteAssistant). */
export const SITE_ASSISTANT_OPEN_EVENT = "vendemas:assistant-open";
export const SITE_ASSISTANT_MAX_INPUT = 500;
/** Mirrors the API contract: only the last 12 turns are sent. */
const MAX_HISTORY = 12;

export interface OpenAssistantDetail {
  /** "chat" jumps straight to the conversation view. */
  view?: "menu" | "chat";
}

export function openSiteAssistant(detail: OpenAssistantDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenAssistantDetail>(SITE_ASSISTANT_OPEN_EVENT, { detail }));
}

/** wa.me link from a configured number (digits only), or null to hide the row. */
export function salesWhatsappHref(raw: string | undefined, text = "Hola, quiero saber más de Vende+ WSP"): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Trailing window of the transcript that satisfies the contract (starts with the user, ends with the user). */
export function historyForRequest(messages: readonly SiteAssistantMessage[]): SiteAssistantMessage[] {
  const trimmed = messages.map((m) => ({ role: m.role, content: m.content.trim().slice(0, SITE_ASSISTANT_MAX_INPUT) })).filter((m) => m.content.length > 0);
  const window = trimmed.slice(-MAX_HISTORY);
  while (window.length > 0 && window[0]?.role !== "user") window.shift();
  return window;
}

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) return "Recibimos muchos mensajes seguidos. Espera un momento o escríbenos por WhatsApp.";
  return "No pude responder ahora. Intenta de nuevo en unos segundos o crea tu cuenta gratis.";
}

export function askSiteAssistant(messages: readonly SiteAssistantMessage[]): Promise<SiteAssistantResponse> {
  return request("/public/assistant", { method: "POST", body: { messages: historyForRequest(messages) }, schema: siteAssistantResponseSchema });
}
