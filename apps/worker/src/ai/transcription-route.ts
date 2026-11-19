import type { LLMProvider } from "@crmwsp/ai";
import type { LlmConnection } from "@crmwsp/db";
import { resolveTranscriptionSource, type TranscriptionCandidate, type TranscriptionSource } from "@crmwsp/domain";
import type { Logger } from "../processors.js";
import { DEFAULT_TRANSCRIPTION_MODEL } from "./transcribe.js";

export interface TranscriptionRoute {
  source: TranscriptionSource;
  provider: Pick<LLMProvider, "transcribe">;
  model: string;
  connectionId: string;
}

function asCandidate(c: LlmConnection): TranscriptionCandidate {
  return { hasKey: c.apiKeyEncrypted !== null, lastTestOk: c.lastTestOk, transcription: c.capabilities.transcription === true };
}

export function transcriptionModelFor(conn: LlmConnection): string {
  const configured = (conn.capabilities as { transcriptionModel?: unknown }).transcriptionModel;
  return typeof configured === "string" && configured.trim() !== "" ? configured.trim() : DEFAULT_TRANSCRIPTION_MODEL;
}

/**
 * Picks the connection that transcribes a voice note (ADR 0024): the dedicated transcription
 * connection when usable, else the chat connection when it can transcribe, else `none` (the
 * turn gets the "audio not transcribed" marker). `build` decrypts the key; a failure there falls
 * back to the chat route. Logs carry only the error class, never keys.
 */
export function transcriptionRoute(
  chat: LlmConnection,
  dedicated: LlmConnection | undefined,
  chatProvider: Pick<LLMProvider, "transcribe">,
  build: (conn: LlmConnection) => Pick<LLMProvider, "transcribe">,
  logger: Logger,
): TranscriptionRoute {
  const chatRoute: TranscriptionRoute = {
    source: resolveTranscriptionSource(null, asCandidate(chat)),
    provider: chatProvider,
    model: transcriptionModelFor(chat),
    connectionId: chat.id,
  };
  if (!dedicated || resolveTranscriptionSource(asCandidate(dedicated), null) !== "dedicated") return chatRoute;
  try {
    return {
      source: "dedicated",
      provider: build(dedicated),
      model: dedicated.modelCheap.trim() || DEFAULT_TRANSCRIPTION_MODEL,
      connectionId: dedicated.id,
    };
  } catch (err) {
    logger.warn(`transcription connection unusable (${err instanceof Error ? err.name : "unknown"}), falling back to chat`);
    return chatRoute;
  }
}
