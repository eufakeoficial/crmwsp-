import type { TTSProvider } from "@crmwsp/ai";
import type { SendResult, WhatsAppConnection, WhatsAppProvider } from "@crmwsp/whatsapp";
import type { MediaStore } from "./media/store.js";
import type { Logger } from "./processors.js";

/** AAD purpose of the encrypted TTS API key (same as apps/api TTS_API_KEY_PURPOSE). */
export const TTS_API_KEY_PURPOSE = "tts_api_key";
/** Lifetime of the presigned URL handed to the BSP to fetch the voice note. */
export const VOICE_URL_TTL_SECONDS = 15 * 60;

export interface VoiceDeps {
  tts: TTSProvider;
  store: MediaStore;
}

export interface VoiceSendInput {
  tenantId: string;
  messageId: string;
  text: string;
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export type VoiceSendOutcome =
  | { kind: "audio"; send: SendResult; storageKey: string; mimeType: string; sizeBytes: number; characters: number }
  | { kind: "text"; send: SendResult; fallbackReason: string };

export const voiceStorageKey = (tenantId: string, messageId: string, mime: string): string =>
  `${tenantId}/outbound/${messageId}.${mime === "audio/ogg" ? "ogg" : "mp3"}`;

/**
 * Sends an already-approved AI text reply as a synthesized voice note. Only the exact approved text
 * is synthesized (no rewriting). Any failure before the BSP call (TTS, storage, URL signing) falls
 * back to sending the same text; BSP send errors propagate unchanged so the normal retry rules apply.
 * Logs carry only error classes, never text, audio, URLs nor keys.
 */
export async function sendVoiceOrText(
  deps: VoiceDeps,
  provider: WhatsAppProvider,
  conn: WhatsAppConnection,
  to: string,
  input: VoiceSendInput,
  logger: Logger,
): Promise<VoiceSendOutcome> {
  let prepared: { url: string; storageKey: string; mimeType: string; sizeBytes: number; characters: number } | undefined;
  let fallbackReason = "tts_error";
  try {
    if (!deps.store.signedGetUrl) {
      fallbackReason = "storage_without_signed_urls";
      throw new Error("no signed urls");
    }
    const audio = await deps.tts.synthesize({ apiKey: input.apiKey, voiceId: input.voiceId, modelId: input.modelId, text: input.text });
    fallbackReason = "storage_error";
    const storageKey = voiceStorageKey(input.tenantId, input.messageId, audio.mimeType);
    await deps.store.put(storageKey, audio.audio, audio.mimeType);
    const url = await deps.store.signedGetUrl(storageKey, VOICE_URL_TTL_SECONDS);
    prepared = { url, storageKey, mimeType: audio.mimeType, sizeBytes: audio.audio.byteLength, characters: audio.characters };
  } catch (err) {
    logger.warn(`voice reply ${input.messageId} fell back to text (${err instanceof Error ? err.name : "unknown"})`);
  }
  if (!prepared) {
    const send = await provider.sendText(conn, to, input.text);
    return { kind: "text", send, fallbackReason };
  }
  const send = await provider.sendMedia(conn, to, { type: "audio", url: prepared.url });
  return {
    kind: "audio",
    send,
    storageKey: prepared.storageKey,
    mimeType: prepared.mimeType,
    sizeBytes: prepared.sizeBytes,
    characters: prepared.characters,
  };
}
