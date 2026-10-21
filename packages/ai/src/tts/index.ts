import { AppError, ErrorCode } from "@crmwsp/contracts";

/** Default ElevenLabs model (multilingual, stable quality). Tenants may override it. */
export const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";
/** ElevenLabs hard limit for eleven_multilingual_v2 is 10k chars; WhatsApp text replies are <= 4096. */
export const TTS_MAX_CHARS = 5_000;

export interface TtsRequest {
  /** Decrypted BYOK key. Never logged nor included in errors. */
  apiKey: string;
  voiceId: string;
  modelId: string;
  text: string;
}

export interface TtsResult {
  audio: Uint8Array;
  /** `audio/ogg` (opus, WhatsApp voice note) or `audio/mpeg`. */
  mimeType: string;
  /** Billable characters sent to the provider. */
  characters: number;
}

/** Port for text-to-speech vendors. */
export interface TTSProvider {
  readonly name: string;
  synthesize(req: TtsRequest): Promise<TtsResult>;
}

/** TTS failure. Never carries the API key, the text nor `cause`. */
export class TtsProviderError extends AppError {
  readonly provider = "tts" as const;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, retryable: boolean, status?: number) {
    super(ErrorCode.ExternalProvider, message, 502, status === undefined ? {} : { details: { status } });
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
  }
}

export interface ElevenLabsOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxAudioBytes?: number;
}

const VOICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MODEL_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * ElevenLabs TTS: POST {baseUrl}/v1/text-to-speech/{voice_id}?output_format=opus_48000_32 with
 * header `xi-api-key` (https://elevenlabs.io/docs/api-reference/text-to-speech/convert). Opus at
 * 48 kHz is returned in an Ogg container, which is what WhatsApp voice notes require.
 */
export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = "elevenlabs";
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAudioBytes: number;

  constructor(opts: ElevenLabsOptions = {}) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.baseUrl = (opts.baseUrl ?? "https://api.elevenlabs.io").replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxAudioBytes = opts.maxAudioBytes ?? 15 * 1024 * 1024;
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const text = req.text.trim();
    if (text === "") throw new TtsProviderError("Nothing to synthesize", false);
    if (text.length > TTS_MAX_CHARS) throw new TtsProviderError("Text too long for TTS", false);
    if (!VOICE_ID_RE.test(req.voiceId)) throw new TtsProviderError("Invalid voice id", false);
    if (!MODEL_ID_RE.test(req.modelId)) throw new TtsProviderError("Invalid model id", false);
    const url = `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(req.voiceId)}?output_format=opus_48000_32`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "xi-api-key": req.apiKey, "content-type": "application/json", accept: "audio/ogg, audio/mpeg" },
        body: JSON.stringify({ text, model_id: req.modelId }),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new TtsProviderError("Network error calling ElevenLabs", true);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new TtsProviderError(`ElevenLabs responded with HTTP ${res.status}`, retryable, res.status);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) throw new TtsProviderError("ElevenLabs returned empty audio", true);
    if (buf.byteLength > this.maxAudioBytes) throw new TtsProviderError("ElevenLabs audio exceeds size limit", false);
    const declared = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    // "OggS" magic => Ogg/Opus; anything else that is mpeg is sent as a regular audio file.
    const isOgg = buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53;
    const mimeType = isOgg ? "audio/ogg" : declared === "audio/mpeg" ? "audio/mpeg" : declared.startsWith("audio/") ? declared : "audio/mpeg";
    return { audio: buf, mimeType, characters: text.length };
  }
}
