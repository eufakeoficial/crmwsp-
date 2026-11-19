import type { Logger } from "../processors.js";
import type { MediaLoader } from "./transcribe.js";

/**
 * Ordinary customer photos in an AI turn (ADR 0025). The image is context for the model only: it
 * never creates price/stock/lead-time claims (the citation gate stays the final authority) and its
 * text is untrusted data. Receipts keep their own flow (receipt.ts) and take precedence.
 */

/** Lower than the receipt cap: a product photo does not need more, and every byte is paid as tokens. */
export const MAX_TURN_IMAGE_BYTES = 5 * 1024 * 1024;
export const TURN_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Added to the draft when the customer sent a photo the AI could not look at (never auto-sent). */
export const IMAGE_NOT_SEEN_NOTE = "El cliente envió una imagen que no pude ver";
/** Placeholder the model reads instead of the photo when it could not be loaded. */
export const IMAGE_NOT_SEEN_MARKER = "[image the assistant could not view]";

export interface TurnImageCandidate {
  messageId: string;
  externalMediaId: string | null;
  mimeType: string | null;
}

export interface TurnImage {
  messageId: string;
  mimeType: string;
  data: Uint8Array;
}

export type TurnImageOutcome = { status: "ready"; image: TurnImage } | { status: "unseen"; reason: string };

interface HistoryLike {
  id: string;
  author: string;
  type: string;
}

/**
 * The most recent customer image after the last non-customer message (one image per turn), so
 * "photo, then question" works while an already-answered photo is never re-sent.
 */
export function pickTurnImageMessageId(history: HistoryLike[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.author !== "contact") return undefined;
    if (m.type === "image") return m.id;
  }
  return undefined;
}

export interface LoadTurnImagePorts {
  tenantId: string;
  conversationId: string;
  /** capabilities.vision of the tenant chat connection. */
  supported: boolean;
  loadMedia: MediaLoader | undefined;
  logger: Logger;
}

/** Never throws; logs only the error class (no bytes, URLs or provider payloads). */
export async function loadTurnImage(cand: TurnImageCandidate, p: LoadTurnImagePorts): Promise<TurnImageOutcome> {
  if (!p.supported) return { status: "unseen", reason: "provider_without_vision" };
  if (!p.loadMedia || !cand.externalMediaId) return { status: "unseen", reason: "media_unavailable" };
  try {
    const media = await p.loadMedia({
      tenantId: p.tenantId,
      conversationId: p.conversationId,
      externalMediaId: cand.externalMediaId,
      mimeType: cand.mimeType,
    });
    const mimeType = (media.mimeType || cand.mimeType || "").split(";")[0]!.trim().toLowerCase();
    if (!(TURN_IMAGE_MIMES as readonly string[]).includes(mimeType)) return { status: "unseen", reason: "unsupported_mime" };
    if (media.data.byteLength === 0) return { status: "unseen", reason: "empty_image" };
    if (media.data.byteLength > MAX_TURN_IMAGE_BYTES) return { status: "unseen", reason: "image_too_large" };
    return { status: "ready", image: { messageId: cand.messageId, mimeType, data: media.data } };
  } catch (err) {
    p.logger.warn(`turn image unavailable (${err instanceof Error ? err.name : "unknown"})`);
    return { status: "unseen", reason: "media_error" };
  }
}

/** Draft text for a turn whose photo could not be viewed: the human sees why before sending. */
export function withImageNotSeenNote(text: string): string {
  return `${IMAGE_NOT_SEEN_NOTE}.\n\n${text}`;
}
