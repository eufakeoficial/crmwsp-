import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@crmwsp/contracts";
import { LlmProviderError, UnsafeBaseUrlError } from "../errors.js";
import { OpenAICompatibleProvider } from "../provider/openai-compatible.js";
import { API_KEY, chatBody, json, mockFetch, publicLookup } from "./helpers.js";
import type { Handler } from "./helpers.js";

const make = (...h: Handler[]) => {
  const fetch = mockFetch(...h);
  const p = new OpenAICompatibleProvider({ baseUrl: "https://api.example.com/v1/", apiKey: API_KEY, fetch, lookup: publicLookup });
  return { p, fetch };
};
const fmt = {
  name: "thing",
  jsonSchema: { type: "object", properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false },
  schema: z.strictObject({ a: z.number() }),
};
const bodyOf = (fetch: ReturnType<typeof mockFetch>, n = 0) => JSON.parse(String(fetch.mock.calls[n]![1]!.body));

async function expectNoKeyLeak(promise: Promise<unknown>): Promise<LlmProviderError> {
  const err = await promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LlmProviderError);
  expect(err).toBeInstanceOf(AppError);
  const e = err as LlmProviderError;
  expect(e.cause).toBeUndefined();
  expect(JSON.stringify({ m: e.message, d: e.details, s: e.stack })).not.toContain(API_KEY);
  return e;
}

describe("chat", () => {
  it("sends key only in Authorization, redirect error and returns usage", async () => {
    const { p, fetch } = make(() => json(chatBody("hola")));
    const r = await p.chat({ model: "gpt-5-mini", messages: [{ role: "user", content: "hi" }], maxTokens: 5 });
    expect(r).toMatchObject({ content: "hola", usage: { inputTokens: 10, outputTokens: 5 }, finishReason: "stop" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`);
    expect(init!.redirect).toBe("error");
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(String(init!.body)).not.toContain(API_KEY);
    expect(bodyOf(fetch).max_tokens).toBe(5);
  });

  it("uses strict json_schema and validates with Zod", async () => {
    const { p, fetch } = make(() => json(chatBody('{"a":1}')));
    const r = await p.chat({ model: "m", messages: [], responseFormat: fmt });
    expect(r.parsed).toEqual({ a: 1 });
    expect(r.structuredMode).toBe("json_schema");
    expect(bodyOf(fetch).response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "thing", schema: fmt.jsonSchema, strict: true },
    });
  });

  it("falls back to json_object on a 400 that blames response_format, and remembers it", async () => {
    const { p, fetch } = make(
      () => json({ error: { message: "response_format type json_schema is not supported by this model", param: "response_format" } }, 400),
      () => json(chatBody('{"a":2}')),
      () => json(chatBody('{"a":3}')),
    );
    const r = await p.chat({ model: "m", messages: [{ role: "user", content: "x" }], responseFormat: fmt });
    expect(r.parsed).toEqual({ a: 2 });
    expect(r.structuredMode).toBe("json_object");
    const b = bodyOf(fetch, 1);
    expect(b.response_format).toEqual({ type: "json_object" });
    expect(b.messages[0].content).toContain('"additionalProperties":false');
    await p.chat({ model: "m", messages: [], responseFormat: fmt });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetch, 2).response_format.type).toBe("json_object");
  });

  it("uses json_object directly when capability is known to be missing", async () => {
    const fetch = mockFetch(() => json(chatBody('{"a":1}')));
    const p = new OpenAICompatibleProvider({ baseUrl: "https://x.example.com", apiKey: API_KEY, fetch, lookup: publicLookup, supportsJsonSchema: false });
    await p.chat({ model: "m", messages: [], responseFormat: fmt });
    expect(bodyOf(fetch).response_format).toEqual({ type: "json_object" });
  });

  it("rejects output failing Zod (extra fields)", async () => {
    const { p } = make(() => json(chatBody('{"a":1,"evil":true}')));
    const e = await expectNoKeyLeak(p.chat({ model: "m", messages: [], responseFormat: fmt }));
    expect(e.retryable).toBe(false);
  });

  it("rejects invalid JSON content", async () => {
    const { p } = make(() => json(chatBody("not json")));
    await expectNoKeyLeak(p.chat({ model: "m", messages: [], responseFormat: fmt }));
  });

  it.each([
    [500, true],
    [503, true],
    [429, true],
    [401, false],
    [404, false],
  ])("HTTP %i → retryable=%s", async (status, retryable) => {
    const { p } = make(() => new Response(`{"error":"bad key ${API_KEY}"}`, { status }));
    const e = await expectNoKeyLeak(p.chat({ model: "m", messages: [] }));
    expect(e.retryable).toBe(retryable);
    expect(e.status).toBe(status);
    expect(e.provider).toBe("llm");
  });

  it("network errors are retryable and do not leak the key", async () => {
    const { p } = make(() => {
      throw new Error(`connect failed Authorization: Bearer ${API_KEY}`);
    });
    const e = await expectNoKeyLeak(p.chat({ model: "m", messages: [] }));
    expect(e.retryable).toBe(true);
  });

  it("enforces response size limit", async () => {
    const fetch = mockFetch(() => new Response("x".repeat(2000), { status: 200 }));
    const p = new OpenAICompatibleProvider({ baseUrl: "https://x.example.com", apiKey: API_KEY, fetch, lookup: publicLookup, maxResponseBytes: 1000 });
    const e = await expectNoKeyLeak(p.chat({ model: "m", messages: [] }));
    expect(e.message).toMatch(/size limit/);
  });

  it("refuses to connect when DNS resolves to a private IP", async () => {
    const fetch = mockFetch(() => json(chatBody("x")));
    const p = new OpenAICompatibleProvider({
      baseUrl: "https://evil.example.com",
      apiKey: API_KEY,
      fetch,
      lookup: async () => [{ address: "8.8.8.8" }, { address: "169.254.169.254" }],
    });
    await expectNoKeyLeak(p.chat({ model: "m", messages: [] }));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("embed", () => {
  it("returns vectors sorted by index", async () => {
    const { p, fetch } = make(() =>
      json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 4 } }),
    );
    const r = await p.embed({ model: "text-embedding-3-small", input: ["a", "b"] });
    expect(r).toEqual({ vectors: [[1, 0], [0, 1]], dims: 2, usage: { inputTokens: 4 } });
    expect(fetch.mock.calls[0]![0]).toBe("https://api.example.com/v1/embeddings");
  });
  it("rejects count mismatch", async () => {
    const { p } = make(() => json({ data: [{ index: 0, embedding: [1] }] }));
    await expectNoKeyLeak(p.embed({ model: "m", input: ["a", "b"] }));
  });
});

describe("transcribe", () => {
  it("posts multipart and returns text", async () => {
    const { p, fetch } = make(() => json({ text: "hola", duration: 1.5 }));
    const r = await p.transcribe({ model: "whisper-1", audio: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg; codecs=opus" });
    expect(r).toEqual({ text: "hola", durationSeconds: 1.5 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/audio/transcriptions");
    const form = init!.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect((form.get("file") as File).name).toBe("audio.ogg");
  });
});

describe("testConnection", () => {
  it("reports every capability", async () => {
    const { p } = make(
      () => json(chatBody('{"ok":true}')),
      () => json(chatBody("p")),
      () => json({ data: [{ index: 0, embedding: [1] }] }),
      () => json({ text: "" }),
      () => json(chatBody("ok")),
    );
    const r = await p.testConnection({ modelCheap: "a", modelStrong: "b" });
    expect(r).toMatchObject({ ok: true, capabilities: { structuredOutput: true, embeddings: true, transcription: true, vision: true } });
    expect(r.error).toBeUndefined();
  });
  it("probes vision with a 1x1 PNG data URI and treats a clear rejection as no vision", async () => {
    const { p, fetch } = make(
      () => json(chatBody('{"ok":true}')),
      () => json(chatBody("p")),
      () => json({ data: [{ index: 0, embedding: [1] }] }),
      () => json({ text: "" }),
      () => json({ error: { message: "image input not supported" } }, 400),
    );
    const r = await p.testConnection({ modelCheap: "a", modelStrong: "b", modelVision: "v" });
    expect(r.capabilities.vision).toBe(false);
    expect(r.ok).toBe(true);
    const body = bodyOf(fetch, 4);
    expect(body.model).toBe("v");
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,iVBOR/);
  });
  it("never echoes the provider error body (a data URI may be inside) in the thrown error", async () => {
    const leak = "data:image/png;base64,AAAA";
    const { p } = make(() => json({ error: { message: `bad image ${leak}` } }, 400));
    const err = await p
      .chat({ model: "a", messages: [{ role: "user", content: "x", images: [{ mimeType: "image/png", data: new Uint8Array([1]) }] }] })
      .then(() => undefined, (e: unknown) => e as LlmProviderError);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(err!.message).toBe("LLM provider responded with HTTP 400");
    expect(JSON.stringify({ m: err!.message, d: err!.details, s: String(err!.stack) })).not.toContain("base64,AAAA");
  });
  it("leaves vision unknown on auth/network errors without failing the test", async () => {
    const { p } = make(
      () => json(chatBody('{"ok":true}')),
      () => json(chatBody("p")),
      () => json({ data: [{ index: 0, embedding: [1] }] }),
      () => json({ text: "" }),
      () => json({}, 401),
    );
    const r = await p.testConnection({ modelCheap: "a", modelStrong: "b" });
    expect(r.ok).toBe(true);
    expect(r.capabilities.vision).toBeUndefined();
    expect(r.error).toBeUndefined();
  });
  it("annotates failing capabilities without throwing", async () => {
    const { p } = make(
      () => json({ error: { message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported" } }, 400),
      () => json(chatBody('{"ok":true}')),
      () => json(chatBody("p")),
      () => json({}, 404),
      () => json({}, 404),
    );
    const r = await p.testConnection({ modelCheap: "a", modelStrong: "b" });
    expect(r.ok).toBe(true);
    expect(r.capabilities).toEqual({ structuredOutput: false, embeddings: false, transcription: false, vision: false });
    expect(r.error).toMatch(/embeddings.*transcription/);
    expect(r.error).not.toContain(API_KEY);
  });
  it("is not ok on auth failure", async () => {
    const { p } = make(() => json({}, 401));
    const r = await p.testConnection({ modelCheap: "a", modelStrong: "b" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("HTTP 401");
  });
});

describe("json_schema fallback is narrow", () => {
  it.each([
    ["invalid model", { error: { message: "The model `gpt-9` does not exist", code: "model_not_found" } }],
    ["bad param", { error: { message: "Invalid value for 'temperature'", param: "temperature" } }],
    ["empty body", {}],
  ])("a 400 for %s is rethrown and does not degrade the instance", async (_n, body) => {
    const { p, fetch } = make(
      () => json(body, 400),
      () => json(chatBody('{"a":1}')),
    );
    const e = await expectNoKeyLeak(p.chat({ model: "m", messages: [], responseFormat: fmt }));
    expect(e.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    const r = await p.chat({ model: "m", messages: [], responseFormat: fmt });
    expect(r.structuredMode).toBe("json_schema");
    expect(bodyOf(fetch, 1).response_format.type).toBe("json_schema");
  });
});

describe("API key never leaks from the provider object", () => {
  it("is absent from JSON.stringify, inspect, toString, keys and spread", async () => {
    const { inspect } = await import("node:util");
    const { p } = make(() => json(chatBody("x")));
    expect(JSON.stringify(p)).not.toContain(API_KEY);
    expect(inspect(p, { depth: 10, showHidden: true })).not.toContain(API_KEY);
    expect(String(p)).not.toContain(API_KEY);
    expect(JSON.stringify({ ...p })).not.toContain(API_KEY);
    expect(Object.getOwnPropertyNames(p).join()).not.toMatch(/apiKey/);
  });
  it("is not logged", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { p } = make(() => new Response(`{"error":"bad ${API_KEY}"}`, { status: 401 }));
    await p.chat({ model: "m", messages: [] }).catch(() => undefined);
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(API_KEY);
      s.mockRestore();
    }
  });
});

describe("SSRF guard runs on every request and every endpoint", () => {
  it("re-resolves DNS before each chat, embed and transcribe call", async () => {
    const lookup = vi.fn(publicLookup);
    const fetch = mockFetch(
      () => json(chatBody("x")),
      () => json({ data: [{ index: 0, embedding: [1] }] }),
      () => json({ text: "t" }),
    );
    const p = new OpenAICompatibleProvider({ baseUrl: "https://api.example.com/v1", apiKey: API_KEY, fetch, lookup });
    await p.chat({ model: "m", messages: [] });
    await p.embed({ model: "m", input: ["a"] });
    await p.transcribe({ model: "m", audio: new Uint8Array([1]), mimeType: "audio/ogg" });
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.every((c) => c[1]!.redirect === "error")).toBe(true);
  });
  it("blocks embed and transcribe after DNS rebinds to a private IP", async () => {
    let addr = "93.184.216.34";
    const fetch = mockFetch(() => json(chatBody("x")));
    const p = new OpenAICompatibleProvider({ baseUrl: "https://api.example.com/v1", apiKey: API_KEY, fetch, lookup: async () => [{ address: addr }] });
    await p.chat({ model: "m", messages: [] });
    addr = "10.0.0.7";
    await expect(p.embed({ model: "m", input: ["a"] })).rejects.toBeInstanceOf(UnsafeBaseUrlError);
    await expect(p.transcribe({ model: "m", audio: new Uint8Array([1]), mimeType: "audio/ogg" })).rejects.toBeInstanceOf(UnsafeBaseUrlError);
    await expect(p.chat({ model: "m", messages: [] })).rejects.toBeInstanceOf(UnsafeBaseUrlError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("insufficient quota detection", () => {
  it.each([
    [429, '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}'],
    [402, '{"error":"Insufficient credits"}'],
    [429, '{"error":{"message":"You exceeded your current quota, please check your plan and billing details."}}'],
  ])("HTTP %i with a quota body is non-retryable with reason insufficient_quota", async (status, body) => {
    const { p } = make(() => new Response(body, { status }));
    const e = await expectNoKeyLeak(p.chat({ model: "m", messages: [] }));
    expect(e.reason).toBe("insufficient_quota");
    expect(e.retryable).toBe(false);
    expect(e.status).toBe(status);
  });

  it("a plain rate-limit 429 stays retryable without a reason", async () => {
    const { p } = make(() => new Response('{"error":{"message":"Rate limit reached for requests"}}', { status: 429 }));
    const e = await expectNoKeyLeak(p.chat({ model: "m", messages: [] }));
    expect(e.reason).toBeUndefined();
    expect(e.retryable).toBe(true);
  });
});
