import { z } from "zod";
import { LlmProviderError, ResponseFormatUnsupportedError } from "../errors.js";
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ConnectionTestRequest,
  ConnectionTestResult,
  EmbedRequest,
  EmbedResult,
  LLMProvider,
  TranscribeRequest,
  TranscribeResult,
} from "./types.js";
import { createSafeFetch } from "./safe-fetch.js";
import { assertSafeBaseUrl, assertSafeBaseUrlSyntax, isDevOrTestEnv } from "./url-safety.js";
import type { LookupFn } from "./url-safety.js";

/*
 * Adapter for any OpenAI-compatible HTTP API (OpenAI, OpenRouter, DeepSeek, ...).
 * Implemented over `fetch` without a vendor SDK: BYOK (ADR 0008) targets several vendors
 * with one code path, and a single-vendor SDK adds weight, its own retry/redirect logic
 * and less control over SSRF, timeouts and response size limits.
 *
 * Endpoints: POST {baseUrl}/chat/completions, /embeddings, /audio/transcriptions.
 */

export interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Max response body size in bytes (default 2 MiB). */
  maxResponseBytes?: number;
  /** Dev only: allow http and local hosts. Ignored in production. */
  allowInsecureLocal?: boolean;
  production?: boolean;
  lookup?: LookupFn;
  /** Known capability; when false, structured output goes straight to `json_object`. */
  supportsJsonSchema?: boolean;
}

const chatResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional(),
});

const embedResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number()) })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative() }).optional(),
});

const transcribeResponseSchema = z.object({ text: z.string(), duration: z.number().nonnegative().optional() });

/** 0.1 s of 8 kHz mono 16-bit silence, used by `testConnection`. */
function tinyWav(): Uint8Array {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples * 2, true);
  return new Uint8Array(buf);
}

const PING_FORMAT = {
  name: "ping",
  jsonSchema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  },
  schema: z.object({ ok: z.boolean() }),
};

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai-compatible";
  private readonly baseUrl: string;
  /** ECMAScript private: invisible to JSON.stringify, util.inspect and object spread. */
  readonly #apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly safety: { allowInsecureLocal?: boolean; production?: boolean; lookup?: LookupFn };
  private jsonSchemaSupported: boolean | undefined;

  constructor(opts: OpenAICompatibleProviderOptions) {
    const safety: { allowInsecureLocal?: boolean; production?: boolean; lookup?: LookupFn } = {};
    if (opts.allowInsecureLocal !== undefined) safety.allowInsecureLocal = opts.allowInsecureLocal;
    if (opts.production !== undefined) safety.production = opts.production;
    if (opts.lookup !== undefined) safety.lookup = opts.lookup;
    this.safety = safety;
    // Fail fast on obviously bad URLs; DNS is re-checked before every request.
    this.baseUrl = assertSafeBaseUrlSyntax(opts.baseUrl, safety).toString().replace(/\/+$/, "");
    this.#apiKey = opts.apiKey;
    // Default transport pins the vetted address on the socket (CN-009: no DNS-rebinding window).
    const insecureDev = opts.allowInsecureLocal === true && opts.production !== true && isDevOrTestEnv();
    this.fetchImpl = opts.fetch ?? createSafeFetch({ ...(opts.lookup ? { lookup: opts.lookup } : {}), allowPrivate: insecureDev });
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxResponseBytes = opts.maxResponseBytes ?? 2 * 1024 * 1024;
    this.jsonSchemaSupported = opts.supportsJsonSchema;
  }

  async chat<T = unknown>(req: ChatRequest<T>): Promise<ChatResult<T>> {
    const rf = req.responseFormat;
    if (!rf) return this.chatOnce<T>(req, undefined, req.messages);

    if (this.jsonSchemaSupported !== false) {
      try {
        const res = await this.chatOnce<T>(
          req,
          { type: "json_schema", json_schema: { name: rf.name, schema: rf.jsonSchema, strict: true } },
          req.messages,
        );
        this.jsonSchemaSupported = true;
        return { ...res, structuredMode: "json_schema" };
      } catch (e) {
        // Only a 400 that explicitly blames response_format/json_schema degrades the instance;
        // any other 400 (bad model, bad params) is rethrown untouched.
        if (!(e instanceof ResponseFormatUnsupportedError)) throw e;
        this.jsonSchemaSupported = false;
      }
    }
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `Respond ONLY with a single JSON object that validates against this JSON Schema (name: ${rf.name}). ` +
          `No prose, no markdown.\n${JSON.stringify(rf.jsonSchema)}`,
      },
      ...req.messages,
    ];
    const res = await this.chatOnce<T>(req, { type: "json_object" }, messages);
    return { ...res, structuredMode: "json_object" };
  }

  private async chatOnce<T>(req: ChatRequest<T>, responseFormat: unknown, messages: ChatMessage[]): Promise<ChatResult<T>> {
    const body: Record<string, unknown> = { model: req.model, messages: messages.map(toWireMessage) };
    if (responseFormat !== undefined) body.response_format = responseFormat;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

    const json = await this.postJson("/chat/completions", body);
    const parsed = chatResponseSchema.safeParse(json);
    if (!parsed.success) throw new LlmProviderError("Unexpected chat response shape", false);
    const choice = parsed.data.choices[0]!;
    const content = choice.message.content ?? "";
    const result: ChatResult<T> = {
      content,
      usage: {
        inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.data.usage?.completion_tokens ?? 0,
      },
      model: parsed.data.model ?? req.model,
      finishReason: choice.finish_reason ?? "unknown",
    };
    if (req.responseFormat) {
      if (choice.message.refusal) throw new LlmProviderError("Model refused to answer", false);
      let raw: unknown;
      try {
        raw = JSON.parse(content);
      } catch {
        throw new LlmProviderError("Model returned invalid JSON", false);
      }
      const valid = req.responseFormat.schema.safeParse(raw);
      if (!valid.success) throw new LlmProviderError("Model output failed schema validation", false);
      result.parsed = valid.data;
    }
    return result;
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const json = await this.postJson("/embeddings", { model: req.model, input: req.input });
    const parsed = embedResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.data.length !== req.input.length) {
      throw new LlmProviderError("Unexpected embeddings response shape", false);
    }
    const vectors = [...parsed.data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    const dims = vectors[0]?.length ?? 0;
    if (dims === 0 || vectors.some((v) => v.length !== dims)) throw new LlmProviderError("Inconsistent embedding dimensions", false);
    return { vectors, dims, usage: { inputTokens: parsed.data.usage?.prompt_tokens ?? 0 } };
  }

  async transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const form = new FormData();
    const ext = req.mimeType.split("/")[1]?.split(";")[0]?.trim() || "bin";
    form.append("file", new Blob([req.audio as Uint8Array<ArrayBuffer>], { type: req.mimeType }), `audio.${ext}`);
    form.append("model", req.model);
    form.append("response_format", "json");
    const res = await this.request("/audio/transcriptions", { method: "POST", body: form });
    const parsed = transcribeResponseSchema.safeParse(await this.readJson(res));
    if (!parsed.success) throw new LlmProviderError("Unexpected transcription response shape", false);
    const out: TranscribeResult = { text: parsed.data.text };
    if (parsed.data.duration !== undefined) out.durationSeconds = parsed.data.duration;
    return out;
  }

  async testConnection(req: ConnectionTestRequest): Promise<ConnectionTestResult> {
    const started = Date.now();
    const errors: string[] = [];
    const caps = { structuredOutput: false, embeddings: false, transcription: false };
    let ok = true;
    const describe = (e: unknown) => (e instanceof LlmProviderError ? e.message : "Unexpected error");

    try {
      const r = await this.chat({
        model: req.modelCheap,
        messages: [{ role: "user", content: 'Return {"ok": true}' }],
        responseFormat: PING_FORMAT,
        maxTokens: 20,
        temperature: 0,
      });
      caps.structuredOutput = r.structuredMode === "json_schema";
    } catch (e) {
      ok = false;
      errors.push(`cheap model: ${describe(e)}`);
    }
    if (req.modelStrong !== req.modelCheap) {
      try {
        await this.chat({ model: req.modelStrong, messages: [{ role: "user", content: "ping" }], maxTokens: 1 });
      } catch (e) {
        ok = false;
        errors.push(`strong model: ${describe(e)}`);
      }
    }
    try {
      await this.embed({ model: req.modelEmbedding ?? "text-embedding-3-small", input: ["ping"] });
      caps.embeddings = true;
    } catch (e) {
      errors.push(`embeddings: ${describe(e)}`);
    }
    try {
      await this.transcribe({ model: req.modelTranscription ?? "whisper-1", audio: tinyWav(), mimeType: "audio/wav" });
      caps.transcription = true;
    } catch (e) {
      errors.push(`transcription: ${describe(e)}`);
    }
    const result: ConnectionTestResult = { ok, capabilities: caps, latencyMs: Date.now() - started };
    if (errors.length > 0) result.error = errors.join("; ");
    return result;
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const res = await this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.readJson(res);
  }

  /** SSRF check + fetch. The API key only travels in `Authorization`; errors never include it. */
  private async request(path: string, init: RequestInit): Promise<Response> {
    await assertSafeBaseUrl(this.baseUrl, this.safety);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), accept: "application/json", authorization: `Bearer ${this.#apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // No `cause`: it may embed request details.
      throw new LlmProviderError("Network error calling LLM provider", true);
    }
    if (!res.ok) {
      if (res.status === 400 && (await this.blamesResponseFormat(res))) throw new ResponseFormatUnsupportedError();
      await res.body?.cancel().catch(() => undefined);
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new LlmProviderError(`LLM provider responded with HTTP ${res.status}`, retryable, res.status);
    }
    return res;
  }

  /**
   * Inspects (at most 16 KiB of) a 400 body to see whether the provider rejected
   * `response_format`/`json_schema`. The body is never surfaced: it may echo request data.
   */
  private async blamesResponseFormat(res: Response): Promise<boolean> {
    let text: string;
    try {
      text = new TextDecoder().decode(await this.readLimited(res, 16 * 1024)).toLowerCase();
    } catch {
      return false;
    }
    const mentionsFormat = /response_format|json_schema|structured[ _-]?output/.test(text);
    const saysUnsupported = /not supported|unsupported|does not support|doesn't support|not available|invalid|unknown|unrecognized/.test(text);
    return mentionsFormat && saysUnsupported;
  }

  private async readJson(res: Response): Promise<unknown> {
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new LlmProviderError("LLM response exceeds size limit", false);
    }
    let text: string;
    try {
      text = new TextDecoder().decode(await this.readLimited(res));
    } catch (e) {
      if (e instanceof LlmProviderError) throw e;
      throw new LlmProviderError("Network error reading LLM response", true);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new LlmProviderError("Invalid JSON from LLM provider", true, res.status);
    }
  }

  private async readLimited(res: Response, limit = this.maxResponseBytes): Promise<Uint8Array> {
    if (!res.body) return new Uint8Array(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new LlmProviderError("LLM response exceeds size limit", false);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }
}

/** OpenAI wire format: messages with images become content parts (text + image_url data URLs). */
export function toWireMessage(m: ChatMessage): Record<string, unknown> {
  if (!m.images || m.images.length === 0) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      { type: "text", text: m.content },
      ...m.images.map((img) => ({
        type: "image_url",
        image_url: { url: `data:${img.mimeType};base64,${Buffer.from(img.data).toString("base64")}` },
      })),
    ],
  };
}
