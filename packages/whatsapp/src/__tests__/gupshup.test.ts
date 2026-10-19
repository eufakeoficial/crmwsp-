import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ExternalProviderError } from "@crmwsp/contracts";
import { GupshupProvider, GupshupProviderError } from "../gupshup/provider.js";
import { generateWebhookToken, safeEqualToken } from "../webhook-token.js";
import type { WhatsAppConnection } from "../types.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const API_KEY = "sk_live_SUPERSECRET_gupshup_key_123";
const conn: WhatsAppConnection = { apiKey: API_KEY, appName: "DemoApp", sourcePhone: "+5491140000000" };
const provider = new GupshupProvider();
const parseOne = (name: string) => {
  const r = provider.parseWebhook(fixture(name), {});
  expect(r).toHaveLength(1);
  return r[0]!;
};

describe("parseWebhook v2 messages", () => {
  it("text", () => {
    const r = parseOne("v2-text");
    expect(r.kind).toBe("message");
    if (r.kind !== "message") return;
    expect(r.dedupeKey).toBe("msg:ABEGVUiZFVUjAhAL3SLAWwHKeKrt6s3FKB0c");
    expect(r.message).toMatchObject({
      from: "+5491155551234",
      type: "text",
      text: "Hola, quiero un presupuesto",
      contactName: "Juan Perez",
    });
    expect(r.message.timestamp.getTime()).toBe(1729339200000);
  });

  it.each([
    ["v2-image", "image", "image/jpeg"],
    ["v2-audio", "audio", "audio/ogg; codecs=opus"],
    ["v2-video", "video", "video/mp4"],
    ["v2-file", "document", "application/pdf"],
  ])("%s → %s media", (name, type, mime) => {
    const r = parseOne(name);
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.type).toBe(type);
    expect(r.message.media?.mimeType).toBe(mime);
    expect(r.message.media?.url).toMatch(/^https:\/\/filemanager\.gupshup\.io\//);
  });

  it("document keeps filename and caption", () => {
    const r = parseOne("v2-file");
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.media).toMatchObject({ filename: "plano.pdf", caption: "Plano" });
  });

  it("location", () => {
    const r = parseOne("v2-location");
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.location).toEqual({ latitude: -34.6037, longitude: -58.3816, name: "Obelisco", address: "Av. 9 de Julio s/n" });
  });

  it("button reply → interactive", () => {
    const r = parseOne("v2-button-reply");
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message).toMatchObject({ type: "interactive", text: "Si, confirmo" });
  });

  it("unknown message type → unsupported", () => {
    const r = parseOne("v2-contact");
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.type).toBe("unsupported");
  });
});

describe("parseWebhook v2 statuses", () => {
  it.each([
    ["v2-status-enqueued", "queued"],
    ["v2-status-sent", "sent"],
    ["v2-status-delivered", "delivered"],
    ["v2-status-read", "read"],
    ["v2-status-failed", "failed"],
  ])("%s → %s keyed by gupshup id", (name, status) => {
    const r = parseOne(name);
    if (r.kind !== "status") throw new Error("expected status");
    expect(r.status.status).toBe(status);
    expect(r.status.externalId).toBe("59f8db86-c2b8-4a43-9e7d-5c4f2b1a0001");
    expect(r.dedupeKey).toBe(`status:59f8db86-c2b8-4a43-9e7d-5c4f2b1a0001:${status}`);
  });

  it("failed carries error", () => {
    const r = parseOne("v2-status-failed");
    if (r.kind !== "status") throw new Error("expected status");
    expect(r.status.error).toEqual({ code: "1002", message: "Number Does Not Exists On WhatsApp" });
  });
});

describe("parseWebhook v3 (Meta passthrough)", () => {
  it("parses messages and statuses", () => {
    const r = provider.parseWebhook(fixture("v3-message-and-status"), {});
    expect(r).toHaveLength(2);
    const [msg, st] = r;
    if (msg?.kind !== "message" || st?.kind !== "status") throw new Error("bad kinds");
    expect(msg.message).toMatchObject({
      from: "+5491155550000",
      to: "+5491140000000",
      type: "image",
      contactName: "Ana",
      media: { externalMediaId: "1456789012345", mimeType: "image/jpeg", caption: "Medidas" },
    });
    expect(st.status).toMatchObject({ externalId: "59f8db86-c2b8-4a43-9e7d-5c4f2b1a0002", status: "failed", error: { code: "131047" } });
  });
});

describe("parseWebhook robustness", () => {
  it.each([null, undefined, 42, "x", [], {}, { type: "message" }, { type: "message", payload: { id: 1 } }, { object: "whatsapp_business_account" }])(
    "garbage %j → ignored",
    (body) => {
      const r = provider.parseWebhook(body, {});
      expect(r.every((x) => x.kind === "ignored")).toBe(true);
    },
  );

  it("user-event → ignored", () => {
    expect(parseOne("v2-user-event").kind).toBe("ignored");
  });

  it("invalid sender phone → ignored", () => {
    const body = fixture("v2-text") as { payload: { source: string } };
    body.payload.source = "0000";
    expect(provider.parseWebhook(body, {})[0]?.kind).toBe("ignored");
  });

  it("dedupeKey is stable across parses", () => {
    for (const name of ["v2-text", "v2-status-read", "v3-message-and-status"]) {
      const a = provider.parseWebhook(fixture(name), {});
      const b = provider.parseWebhook(fixture(name), {});
      expect(a.map((x) => ("dedupeKey" in x ? x.dedupeKey : null))).toEqual(
        b.map((x) => ("dedupeKey" in x ? x.dedupeKey : null)),
      );
    }
  });
});

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("sending", () => {
  it("sendText posts form to /wa/api/v1/msg", async () => {
    const f = mockFetch(202, { status: "submitted", messageId: "gs-1" });
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch });
    await expect(p.sendText(conn, "+5491155551234", "hola")).resolves.toEqual({ externalId: "gs-1" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.gupshup.io/wa/api/v1/msg");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.apikey).toBe(API_KEY);
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(init?.body as string);
    expect(form.get("channel")).toBe("whatsapp");
    expect(form.get("source")).toBe("5491140000000");
    expect(form.get("destination")).toBe("5491155551234");
    expect(form.get("src.name")).toBe("DemoApp");
    expect(JSON.parse(form.get("message")!)).toEqual({ type: "text", text: "hola" });
  });

  it("sendTemplate posts to /wa/api/v1/template/msg", async () => {
    const f = mockFetch(200, { status: "submitted", messageId: "gs-2" });
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch, baseUrl: "https://example.test/" });
    await expect(p.sendTemplate(conn, "+5491155551234", "tpl-uuid", ["Juan", "123"])).resolves.toEqual({ externalId: "gs-2" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://example.test/wa/api/v1/template/msg");
    const form = new URLSearchParams(init?.body as string);
    expect(JSON.parse(form.get("template")!)).toEqual({ id: "tpl-uuid", params: ["Juan", "123"] });
  });

  it("sendMedia document uses type file", async () => {
    const f = mockFetch(200, { status: "submitted", messageId: "gs-3" });
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch });
    await p.sendMedia(conn, "+5491155551234", { type: "document", url: "https://x.test/a.pdf", filename: "a.pdf", caption: "c" });
    const form = new URLSearchParams(f.mock.calls[0]![1]?.body as string);
    expect(JSON.parse(form.get("message")!)).toEqual({ type: "file", url: "https://x.test/a.pdf", filename: "a.pdf", caption: "c" });
  });

  const capture = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      return e;
    }
    throw new Error("expected rejection");
  };

  const assertNoSecret = (e: unknown) => {
    const dump = JSON.stringify(e, Object.getOwnPropertyNames(e as object)) + String(e) + String((e as Error).stack);
    expect(dump).not.toContain(API_KEY);
    expect(dump).not.toContain("hola secreta");
  };

  it("400 → non-retryable ExternalProviderError without secrets", async () => {
    const p = new GupshupProvider({ fetch: mockFetch(400, { status: "error", message: "bad" }) as unknown as typeof fetch });
    const e = await capture(() => p.sendText(conn, "+5491155551234", "hola secreta"));
    expect(e).toBeInstanceOf(ExternalProviderError);
    expect(e).toBeInstanceOf(GupshupProviderError);
    expect((e as GupshupProviderError).provider).toBe("gupshup");
    expect((e as GupshupProviderError).retryable).toBe(false);
    assertNoSecret(e);
  });

  it("503 → retryable", async () => {
    const p = new GupshupProvider({ fetch: mockFetch(503, {}) as unknown as typeof fetch });
    const e = await capture(() => p.sendTemplate(conn, "+5491155551234", "t", []));
    expect((e as GupshupProviderError).retryable).toBe(true);
    assertNoSecret(e);
  });

  it("network error → retryable, no secret", async () => {
    const f = vi.fn(async () => {
      throw new TypeError(`fetch failed apikey=${API_KEY}`);
    });
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch });
    const e = await capture(() => p.sendText(conn, "+5491155551234", "hola secreta"));
    expect((e as GupshupProviderError).retryable).toBe(true);
    assertNoSecret(e);
  });

  it("2xx with non-submitted status → non-retryable", async () => {
    const p = new GupshupProvider({ fetch: mockFetch(200, { status: "error", message: "Invalid app" }) as unknown as typeof fetch });
    const e = await capture(() => p.sendText(conn, "+5491155551234", "hola secreta"));
    expect((e as GupshupProviderError).retryable).toBe(false);
  });
});

describe("downloadMedia", () => {
  it("downloads from allowed gupshup host", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch });
    const r = await p.downloadMedia(conn, { url: "https://filemanager.gupshup.io/wa/x" });
    expect(Array.from(r.data)).toEqual([1, 2, 3]);
    expect(r.mimeType).toBe("image/jpeg");
  });

  it("refuses foreign hosts (never sends apikey there)", async () => {
    const f = vi.fn();
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch });
    await expect(p.downloadMedia(conn, { url: "https://evil.test/gupshup.io" })).rejects.toBeInstanceOf(GupshupProviderError);
    await expect(p.downloadMedia(conn, { url: "http://filemanager.gupshup.io/x" })).rejects.toBeInstanceOf(GupshupProviderError);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses allowlist bypasses: suffix tricks, userinfo, ports", async () => {
    const f = vi.fn();
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch });
    for (const url of [
      "https://gupshup.io.evil.com/x",
      "https://evilgupshup.io/x",
      "https://evil@filemanager.gupshup.io/x",
      "https://filemanager.gupshup.io@evil.com/x",
      "https://filemanager.gupshup.io:8443/x",
      "https://user:pw@filemanager.gupshup.io/x",
    ]) {
      await expect(p.downloadMedia(conn, { url })).rejects.toBeInstanceOf(GupshupProviderError);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("accepts uppercase hosts and refuses to follow redirects", async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response(new Uint8Array([1]), { status: 200 }));
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch });
    await p.downloadMedia(conn, { url: "https://FileManager.GUPSHUP.io/x" });
    expect(f.mock.calls[0]![1].redirect).toBe("error");
    expect(f.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("enforces a size limit (declared and streamed)", async () => {
    const big = vi.fn(async () => new Response(new Uint8Array(10), { status: 200, headers: { "content-length": "10" } }));
    const p1 = new GupshupProvider({ fetch: big as unknown as typeof fetch, maxMediaBytes: 5 });
    await expect(p1.downloadMedia(conn, { url: "https://filemanager.gupshup.io/x" })).rejects.toThrow(/size limit/);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(4));
        c.enqueue(new Uint8Array(4));
        c.close();
      },
    });
    const chunked = vi.fn(async () => new Response(stream, { status: 200 }));
    const p2 = new GupshupProvider({ fetch: chunked as unknown as typeof fetch, maxMediaBytes: 5 });
    await expect(p2.downloadMedia(conn, { url: "https://filemanager.gupshup.io/x" })).rejects.toThrow(/size limit/);
  });

  it("redirect/network failure maps to error without apikey", async () => {
    const f = vi.fn(async () => {
      throw new TypeError(`redirect to https://evil.com with ${API_KEY}`);
    });
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch });
    const e = await p.downloadMedia(conn, { url: "https://filemanager.gupshup.io/x" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GupshupProviderError);
    expect(JSON.stringify(e) + String(e)).not.toContain(API_KEY);
  });
});

describe("parser hardening", () => {
  it("never throws on hostile input", () => {
    const huge = { object: "whatsapp_business_account", entry: Array.from({ length: 5000 }, () => ({ changes: [{ value: { messages: [{ id: 1 }] } }] })) };
    const cyclic: Record<string, unknown> = { type: "message" };
    cyclic.payload = cyclic;
    for (const b of [null, 1, "x", [], huge, cyclic, { type: "message", payload: { id: "a".repeat(1e6) } }, { type: { toString: null } }]) {
      expect(() => provider.parseWebhook(b, {})).not.toThrow();
    }
  });
});

describe("webhook token", () => {
  it("generates 256-bit base64url tokens", () => {
    const t = generateWebhookToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookToken()).not.toBe(t);
  });

  it("compares safely", () => {
    const t = generateWebhookToken();
    expect(safeEqualToken(t, t)).toBe(true);
    expect(safeEqualToken(t, `${t}x`)).toBe(false);
    expect(safeEqualToken(t, "")).toBe(false);
  });
});
