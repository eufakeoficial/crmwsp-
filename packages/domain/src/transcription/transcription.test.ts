import { describe, expect, it } from "vitest";
import { resolveTranscriptionSource, type TranscriptionCandidate } from "./index.js";

const ok: TranscriptionCandidate = { hasKey: true, lastTestOk: true, transcription: true };
const noAudio: TranscriptionCandidate = { hasKey: true, lastTestOk: true, transcription: false };

describe("resolveTranscriptionSource", () => {
  it("prefers the dedicated connection", () => {
    expect(resolveTranscriptionSource(ok, ok)).toBe("dedicated");
    expect(resolveTranscriptionSource(ok, noAudio)).toBe("dedicated");
  });

  it("falls back to the chat connection when it can transcribe", () => {
    expect(resolveTranscriptionSource(null, ok)).toBe("chat");
    expect(resolveTranscriptionSource({ ...ok, lastTestOk: false }, ok)).toBe("chat");
    expect(resolveTranscriptionSource({ ...ok, lastTestOk: null }, ok)).toBe("chat");
    expect(resolveTranscriptionSource({ ...ok, hasKey: false }, ok)).toBe("chat");
  });

  it("is none when neither can transcribe", () => {
    expect(resolveTranscriptionSource(null, noAudio)).toBe("none");
    expect(resolveTranscriptionSource(undefined, undefined)).toBe("none");
    expect(resolveTranscriptionSource({ ...ok, transcription: false }, { ...ok, lastTestOk: false })).toBe("none");
  });
});
