import { estimateTranscriptionCost, type LLMProvider } from "@crmwsp/ai";
import type { DownloadedMedia } from "@crmwsp/whatsapp";
import { type Logger } from "../processors.js";

/** Marker fed to the AI when a voice note could not be turned into text. */
export const AUDIO_NOT_TRANSCRIBED = "[audio not transcribed]";
export const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";
/** OpenAI-compatible transcription endpoints cap uploads at 25 MB. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Rough WhatsApp voice-note bitrate (opus ~16 kbps), used only when the provider reports no duration. */
const ESTIMATED_BYTES_PER_SECOND = 2_000;

export interface AudioAttachment {
  id: string;
  externalMediaId: string | null;
  mimeType: string | null;
  transcript: string | null;
}

/** Resolves the bytes of an inbound media (BSP download). Injected so tests need no network. */
export type MediaLoader = (ref: {
  tenantId: string;
  conversationId: string;
  externalMediaId: string;
  mimeType: string | null;
}) => Promise<DownloadedMedia>;

export type TranscribeOutcome =
  | { status: "cached"; text: string }
  | { status: "transcribed"; text: string; model: string; seconds: number; durationEstimated: boolean; costMinor: number; priceKnown: boolean; verified: boolean }
  | { status: "unavailable" | "failed"; reason: string };

export interface TranscribePorts {
  tenantId: string;
  conversationId: string;
  provider: Pick<LLMProvider, "transcribe">;
  /** False when the tenant's provider does not support transcription (capabilities.transcription). */
  supported: boolean;
  model: string;
  loadMedia: MediaLoader | undefined;
  logger: Logger;
}

/**
 * Transcribes one audio attachment once. Never throws: every failure degrades to
 * `{ status: "failed" | "unavailable" }` so the AI turn proceeds with a marker. Logs carry only
 * the error class, never audio, text or provider messages.
 */
export async function transcribeAttachment(att: AudioAttachment, p: TranscribePorts): Promise<TranscribeOutcome> {
  if (att.transcript !== null && att.transcript.trim() !== "") return { status: "cached", text: att.transcript.trim() };
  if (!p.supported) return { status: "unavailable", reason: "provider_without_transcription" };
  if (!p.loadMedia || !att.externalMediaId) return { status: "unavailable", reason: "media_unavailable" };
  try {
    const media = await p.loadMedia({
      tenantId: p.tenantId,
      conversationId: p.conversationId,
      externalMediaId: att.externalMediaId,
      mimeType: att.mimeType,
    });
    if (media.data.byteLength === 0) return { status: "failed", reason: "empty_audio" };
    if (media.data.byteLength > MAX_AUDIO_BYTES) return { status: "failed", reason: "audio_too_large" };
    const res = await p.provider.transcribe({
      model: p.model,
      audio: media.data,
      mimeType: media.mimeType || att.mimeType || "audio/ogg",
    });
    const text = res.text.trim();
    if (text === "") return { status: "failed", reason: "empty_transcript" };
    const durationEstimated = res.durationSeconds === undefined;
    const seconds = res.durationSeconds ?? Math.ceil(media.data.byteLength / ESTIMATED_BYTES_PER_SECOND);
    const cost = estimateTranscriptionCost(p.model, seconds);
    return {
      status: "transcribed",
      text,
      model: p.model,
      seconds,
      durationEstimated,
      costMinor: cost.costMinor,
      priceKnown: cost.known,
      verified: cost.verified,
    };
  } catch (err) {
    p.logger.warn(`audio transcription failed (${err instanceof Error ? err.name : "unknown"})`);
    return { status: "failed", reason: "transcription_error" };
  }
}

/** Text the AI sees for a voice note. */
export function voiceNoteText(outcome: TranscribeOutcome): string {
  return outcome.status === "cached" || outcome.status === "transcribed"
    ? `[voice note] ${outcome.text}`
    : AUDIO_NOT_TRANSCRIBED;
}
