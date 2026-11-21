/**
 * Which LLM connection transcribes inbound voice notes (ADR 0024).
 *
 * 1. The dedicated `transcription` connection, when active, keyed and last tested OK.
 * 2. Otherwise the chat connection, when tested OK and its test proved transcription.
 * 3. Otherwise none: the AI turn sees the "audio not transcribed" marker.
 */
export type TranscriptionSource = "dedicated" | "chat" | "none";

export interface TranscriptionCandidate {
  hasKey: boolean;
  lastTestOk: boolean | null;
  /** Result of the capability probe (`capabilities.transcription`). */
  transcription: boolean;
}

export function resolveTranscriptionSource(
  dedicated: TranscriptionCandidate | null | undefined,
  chat: TranscriptionCandidate | null | undefined,
): TranscriptionSource {
  if (usable(dedicated)) return "dedicated";
  if (usable(chat)) return "chat";
  return "none";
}

function usable(c: TranscriptionCandidate | null | undefined): boolean {
  return !!c && c.hasKey && c.lastTestOk === true && c.transcription;
}
