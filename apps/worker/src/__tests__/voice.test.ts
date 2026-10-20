import { ElevenLabsTTSProvider } from "@crmwsp/ai";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import { describe, expect, it, vi } from "vitest";
import { presignS3GetUrl, type MediaStore } from "../media/store.js";
import { sendVoiceOrText } from "../voice.js";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const conn = { apiKey: "gs", appName: "app", sourcePhone: "+100" };
const input = { tenantId: "t1", messageId: "m1", text: "Hola, tu pedido está listo", apiKey: "xi-secret", voiceId: "v1", modelId: "eleven_multilingual_v2" };

function wa() {
  return {
    sendText: vi.fn(async () => ({ externalId: "txt-1" })),
    sendMedia: vi.fn(async () => ({ externalId: "aud-1" })),
  } as unknown as WhatsAppProvider & { sendText: ReturnType<typeof vi.fn>; sendMedia: ReturnType<typeof vi.fn> };
}

function store(withUrl = true): MediaStore & { put: ReturnType<typeof vi.fn> } {
  const s = { put: vi.fn(async () => {}), get: vi.fn() } as unknown as MediaStore & { put: ReturnType<typeof vi.fn> };
  if (withUrl) s.signedGetUrl = async (k: string) => `https://s3.test/${k}?sig=1`;
  return s;
}

describe("sendVoiceOrText", () => {
  it("synthesizes the approved text, stores it and sends an audio message", async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 9]), { status: 200 }));
    const p = wa();
    const st = store();
    const out = await sendVoiceOrText({ tts: new ElevenLabsTTSProvider({ fetch: f }), store: st }, p, conn, "+200", input, silent);
    expect(out.kind).toBe("audio");
    if (out.kind !== "audio") return;
    expect(out.storageKey).toBe("t1/outbound/m1.ogg");
    expect(out.characters).toBe(input.text.length);
    expect(st.put).toHaveBeenCalledWith("t1/outbound/m1.ogg", expect.any(Uint8Array), "audio/ogg");
    expect(p.sendMedia).toHaveBeenCalledWith(conn, "+200", { type: "audio", url: "https://s3.test/t1/outbound/m1.ogg?sig=1" });
    expect(p.sendText).not.toHaveBeenCalled();
    expect(JSON.parse((f.mock.calls[0]?.[1] as RequestInit).body as string).text).toBe(input.text);
  });

  it("falls back to the same text when TTS fails", async () => {
    const f = vi.fn<typeof fetch>(async () => new Response("quota", { status: 401 }));
    const p = wa();
    const out = await sendVoiceOrText({ tts: new ElevenLabsTTSProvider({ fetch: f }), store: store() }, p, conn, "+200", input, silent);
    expect(out).toMatchObject({ kind: "text", fallbackReason: "tts_error" });
    expect(p.sendText).toHaveBeenCalledWith(conn, "+200", input.text);
    expect(p.sendMedia).not.toHaveBeenCalled();
  });

  it("falls back to text when storage cannot sign URLs, without calling TTS", async () => {
    const f = vi.fn<typeof fetch>();
    const p = wa();
    const out = await sendVoiceOrText({ tts: new ElevenLabsTTSProvider({ fetch: f }), store: store(false) }, p, conn, "+200", input, silent);
    expect(out.kind).toBe("text");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("presignS3GetUrl", () => {
  it("builds a SigV4 query-signed URL (AWS documented example)", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = presignS3GetUrl(
      {
        endpoint: "https://s3.amazonaws.com",
        region: "us-east-1",
        bucket: "examplebucket",
        accessKey: "AKIAIOSFODNN7EXAMPLE",
        secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        forcePathStyle: false,
      },
      "test.txt",
      86_400,
      new Date("2013-05-24T00:00:00Z"),
    );
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});
