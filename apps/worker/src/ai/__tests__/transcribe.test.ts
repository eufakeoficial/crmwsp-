import { estimateTranscriptionCost } from "@crmwsp/ai";
import { describe, expect, it, vi } from "vitest";
import { AUDIO_NOT_TRANSCRIBED, MAX_AUDIO_BYTES, transcribeAttachment, voiceNoteText, type TranscribePorts } from "../transcribe.js";

const att = { id: "a1", externalMediaId: "https://media/x", mimeType: "audio/ogg", transcript: null };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function ports(over: Partial<TranscribePorts> = {}): TranscribePorts {
  return {
    tenantId: "t",
    conversationId: "c",
    provider: { transcribe: vi.fn().mockResolvedValue({ text: " hola quiero cotizar ", durationSeconds: 12 }) },
    supported: true,
    model: "whisper-1",
    loadMedia: vi.fn().mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg" }),
    logger,
    ...over,
  };
}

describe("transcribeAttachment", () => {
  it("transcribes and prices by duration", async () => {
    const p = ports();
    const r = await transcribeAttachment(att, p);
    expect(r).toMatchObject({ status: "transcribed", text: "hola quiero cotizar", seconds: 12, durationEstimated: false });
    expect(r.status === "transcribed" && r.costMinor).toBe(estimateTranscriptionCost("whisper-1", 12).costMinor);
    expect(voiceNoteText(r)).toBe("[voice note] hola quiero cotizar");
  });

  it("reuses a stored transcript without calling anything", async () => {
    const p = ports();
    const r = await transcribeAttachment({ ...att, transcript: "ya estaba" }, p);
    expect(r).toEqual({ status: "cached", text: "ya estaba" });
    expect(p.loadMedia).not.toHaveBeenCalled();
    expect(p.provider.transcribe).not.toHaveBeenCalled();
  });

  it("estimates duration from size when the provider reports none", async () => {
    const p = ports({ provider: { transcribe: vi.fn().mockResolvedValue({ text: "hi" }) }, loadMedia: vi.fn().mockResolvedValue({ data: new Uint8Array(4000), mimeType: "audio/ogg" }) });
    const r = await transcribeAttachment(att, p);
    expect(r).toMatchObject({ status: "transcribed", seconds: 2, durationEstimated: true });
  });

  it("is unavailable when the provider lacks transcription or media cannot be loaded", async () => {
    const a = await transcribeAttachment(att, ports({ supported: false }));
    expect(a).toMatchObject({ status: "unavailable" });
    expect(voiceNoteText(a)).toBe(AUDIO_NOT_TRANSCRIBED);
    expect(await transcribeAttachment(att, ports({ loadMedia: undefined }))).toMatchObject({ status: "unavailable" });
    expect(await transcribeAttachment({ ...att, externalMediaId: null }, ports())).toMatchObject({ status: "unavailable" });
  });

  it("degrades to the marker and logs when download or transcription throws", async () => {
    logger.warn.mockClear();
    const r1 = await transcribeAttachment(att, ports({ loadMedia: vi.fn().mockRejectedValue(new Error("secret url")) }));
    expect(r1).toMatchObject({ status: "failed" });
    const r2 = await transcribeAttachment(att, ports({ provider: { transcribe: vi.fn().mockRejectedValue(new TypeError("boom")) } }));
    expect(voiceNoteText(r2)).toBe(AUDIO_NOT_TRANSCRIBED);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    for (const call of logger.warn.mock.calls) expect(String(call[0])).not.toMatch(/secret|boom/);
  });

  it("rejects empty, oversized and blank-transcript audio", async () => {
    const big = { data: { byteLength: MAX_AUDIO_BYTES + 1 } as unknown as Uint8Array, mimeType: "audio/ogg" };
    expect(await transcribeAttachment(att, ports({ loadMedia: vi.fn().mockResolvedValue(big) }))).toMatchObject({ reason: "audio_too_large" });
    expect(await transcribeAttachment(att, ports({ loadMedia: vi.fn().mockResolvedValue({ data: new Uint8Array(0), mimeType: "audio/ogg" }) }))).toMatchObject({ reason: "empty_audio" });
    expect(await transcribeAttachment(att, ports({ provider: { transcribe: vi.fn().mockResolvedValue({ text: "  " }) } }))).toMatchObject({ reason: "empty_transcript" });
  });
});

describe("estimateTranscriptionCost", () => {
  it("prices whisper-1 at $0.006/min and flags unknown models", () => {
    expect(estimateTranscriptionCost("whisper-1", 60)).toMatchObject({ costMinor: 600_000, known: true, verified: false });
    expect(estimateTranscriptionCost("other", 60)).toMatchObject({ costMinor: 0, known: false });
  });
});
