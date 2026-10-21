import { describe, expect, it, vi } from "vitest";
import { ElevenLabsTTSProvider, TtsProviderError } from "../tts/index.js";

const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]);

function mockFetch(res: Response) {
  return vi.fn<typeof fetch>(async () => res);
}

describe("ElevenLabsTTSProvider", () => {
  it("posts text with xi-api-key, requests opus and detects ogg", async () => {
    const f = mockFetch(new Response(OGG, { status: 200, headers: { "content-type": "audio/ogg" } }));
    const p = new ElevenLabsTTSProvider({ fetch: f });
    const out = await p.synthesize({ apiKey: "sk-secret", voiceId: "voice_1", modelId: "eleven_multilingual_v2", text: " Hola " });
    expect(out.mimeType).toBe("audio/ogg");
    expect(out.characters).toBe(4);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice_1?output_format=opus_48000_32");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("sk-secret");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Hola", model_id: "eleven_multilingual_v2" });
  });

  it("falls back to audio/mpeg when not ogg", async () => {
    const f = mockFetch(new Response(new Uint8Array([0xff, 0xfb, 1]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const out = await new ElevenLabsTTSProvider({ fetch: f }).synthesize({ apiKey: "k", voiceId: "v", modelId: "m", text: "x" });
    expect(out.mimeType).toBe("audio/mpeg");
  });

  it("maps HTTP errors without leaking the key", async () => {
    const f = mockFetch(new Response("bad key sk-secret", { status: 401 }));
    const err = await new ElevenLabsTTSProvider({ fetch: f })
      .synthesize({ apiKey: "sk-secret", voiceId: "v", modelId: "m", text: "x" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TtsProviderError);
    expect((err as TtsProviderError).retryable).toBe(false);
    expect(String((err as Error).message)).not.toContain("sk-secret");
  });

  it("marks 5xx and network errors retryable", async () => {
    const e1 = await new ElevenLabsTTSProvider({ fetch: mockFetch(new Response("", { status: 503 })) })
      .synthesize({ apiKey: "k", voiceId: "v", modelId: "m", text: "x" })
      .catch((e: unknown) => e as TtsProviderError);
    expect((e1 as TtsProviderError).retryable).toBe(true);
    const e2 = await new ElevenLabsTTSProvider({ fetch: vi.fn<typeof fetch>(async () => Promise.reject(new Error("boom k"))) })
      .synthesize({ apiKey: "k", voiceId: "v", modelId: "m", text: "x" })
      .catch((e: unknown) => e as TtsProviderError);
    expect((e2 as TtsProviderError).retryable).toBe(true);
  });

  it("rejects invalid voice ids and empty text before calling the network", async () => {
    const f = vi.fn<typeof fetch>();
    const p = new ElevenLabsTTSProvider({ fetch: f });
    await expect(p.synthesize({ apiKey: "k", voiceId: "../x", modelId: "m", text: "x" })).rejects.toBeInstanceOf(TtsProviderError);
    await expect(p.synthesize({ apiKey: "k", voiceId: "v", modelId: "m", text: "  " })).rejects.toBeInstanceOf(TtsProviderError);
    expect(f).not.toHaveBeenCalled();
  });
});
