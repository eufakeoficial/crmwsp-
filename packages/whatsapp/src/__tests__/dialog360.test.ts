import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ExternalProviderError } from "@crmwsp/contracts";
import { Dialog360Provider, Dialog360ProviderError, parseTemplateExternalId } from "../dialog360/provider.js";
import { BSP_HEADER, RoutingWhatsAppProvider } from "../router.js";
import { GupshupProvider } from "../gupshup/provider.js";
import type { WhatsAppConnection } from "../types.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const API_KEY = "d360_SUPERSECRET_channel_key_123";
const conn: WhatsAppConnection = { provider: "360dialog", apiKey: API_KEY, appName: "CH_ID", sourcePhone: "+5491140000000" };
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

function mockFetch(...responses: Array<Response | Error>) {
  return vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    if (next instanceof Error) throw next;
    return next;
  });
}
const asFetch = (f: ReturnType<typeof mockFetch>) => f as unknown as typeof fetch;
const call = (fn: ReturnType<typeof mockFetch>, i = 0) => {
  const [url, init] = fn.mock.calls[i] as unknown as [string, RequestInit];
  return { url, init, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined };
};

describe("parseWebhook", () => {
  const p = new Dialog360Provider();

  it("parses a text message", () => {
    const r = p.parseWebhook(fixture("d360-text"), {});
    expect(r).toHaveLength(1);
    const m = r[0]!;
    expect(m.kind).toBe("message");
    if (m.kind !== "message") return;
    expect(m.dedupeKey).toBe("msg:wamid.HBgLNTQ5MTE1NTU1MTIzNBUCABIYFA");
    expect(m.message).toMatchObject({
      from: "+5491155551234",
      to: "+5491140000000",
      type: "text",
      text: "Hola, quiero un presupuesto",
      contactName: "Juan Perez",
    });
    expect(m.message.timestamp.getTime()).toBe(1729339200000);
  });

  it("parses image media by id", () => {
    const m = p.parseWebhook(fixture("d360-image"), {})[0]!;
    if (m.kind !== "message") throw new Error("expected message");
    expect(m.message.type).toBe("image");
    expect(m.message.media).toMatchObject({ externalMediaId: "MEDIA123", mimeType: "image/jpeg", caption: "foto" });
  });

  it("parses statuses with distinct dedupe keys and failure details", () => {
    const r = p.parseWebhook(fixture("d360-status"), {});
    expect(r.map((x) => (x.kind === "status" ? x.dedupeKey : x.kind))).toEqual([
      "status:wamid.OUT1:delivered",
      "status:wamid.OUT2:failed",
    ]);
    const failed = r[1]!;
    if (failed.kind !== "status") throw new Error("expected status");
    expect(failed.status.error).toEqual({ code: "131047", message: "Re-engagement message" });
  });

  it.each([null, "x", 42, {}, { object: "page" }, { type: "message" }])("ignores %j without throwing", (body) => {
    expect(p.parseWebhook(body, {}).every((x) => x.kind === "ignored")).toBe(true);
  });
});

describe("sending", () => {
  it("sendText posts Cloud API JSON with the D360-API-KEY header", async () => {
    const f = mockFetch(json({ messages: [{ id: "wamid.SENT1" }] }));
    const p = new Dialog360Provider({ fetch: asFetch(f) });
    expect(await p.sendText(conn, "+5491155551234", "hola", { previewUrl: false })).toEqual({ externalId: "wamid.SENT1" });
    const { url, init, body } = call(f);
    expect(url).toBe("https://waba-v2.360dialog.io/messages");
    expect((init.headers as Record<string, string>)["D360-API-KEY"]).toBe(API_KEY);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5491155551234",
      type: "text",
      text: { body: "hola", preview_url: false },
    });
  });

  it("sendMedia maps image, audio and document", async () => {
    const f = mockFetch(json({ messages: [{ id: "a" }] }), json({ messages: [{ id: "b" }] }), json({ messages: [{ id: "c" }] }));
    const p = new Dialog360Provider({ fetch: asFetch(f) });
    await p.sendMedia(conn, "+5491155551234", { type: "image", url: "https://x/y.jpg", caption: "c" });
    await p.sendMedia(conn, "+5491155551234", { type: "audio", url: "https://x/y.ogg", caption: "ignored" });
    await p.sendMedia(conn, "+5491155551234", { type: "document", url: "https://x/y.pdf", filename: "p.pdf" });
    expect(call(f, 0).body).toMatchObject({ type: "image", image: { link: "https://x/y.jpg", caption: "c" } });
    expect(call(f, 1).body?.["audio"]).toEqual({ link: "https://x/y.ogg" });
    expect(call(f, 2).body).toMatchObject({ type: "document", document: { link: "https://x/y.pdf", filename: "p.pdf" } });
  });

  it("sendTemplate uses name|language and body parameters", async () => {
    const f = mockFetch(json({ messages: [{ id: "t1" }] }));
    await new Dialog360Provider({ fetch: asFetch(f) }).sendTemplate(conn, "+5491155551234", "presupuesto_listo|es_AR", ["Juan", "100"]);
    expect(call(f).body).toMatchObject({
      type: "template",
      template: {
        name: "presupuesto_listo",
        language: { code: "es_AR" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Juan" }, { type: "text", text: "100" }] }],
      },
    });
  });

  it("sendTemplate rejects a malformed reference", () => {
    const p = new Dialog360Provider({ fetch: asFetch(mockFetch()) });
    expect(() => p.sendTemplate(conn, "+5491155551234", "no-language", [])).toThrow(Dialog360ProviderError);
  });

  it("sendReaction", async () => {
    const f = mockFetch(json({ messages: [{ id: "r1" }] }));
    await new Dialog360Provider({ fetch: asFetch(f) }).sendReaction(conn, { to: "+5491155551234", messageExternalId: "wamid.X", emoji: "\u{1F44D}" });
    expect(call(f).body).toMatchObject({ type: "reaction", reaction: { message_id: "wamid.X", emoji: "\u{1F44D}" } });
  });

  it("maps 5xx/429 to retryable and 4xx to permanent, without leaking the key", async () => {
    const attempt = (r: Response | Error) =>
      new Dialog360Provider({ fetch: asFetch(mockFetch(r)) }).sendText(conn, "+5491155551234", "a").catch((e: unknown) => e);
    const e503 = await attempt(new Response("x", { status: 503 }));
    const e429 = await attempt(new Response("x", { status: 429 }));
    const e400 = await attempt(new Response(API_KEY, { status: 400 }));
    const net = await attempt(new Error(`boom ${API_KEY}`));
    expect(e503).toBeInstanceOf(ExternalProviderError);
    expect((e503 as Dialog360ProviderError).retryable).toBe(true);
    expect((e429 as Dialog360ProviderError).retryable).toBe(true);
    expect((e400 as Dialog360ProviderError).retryable).toBe(false);
    expect((net as Dialog360ProviderError).retryable).toBe(true);
    for (const e of [e503, e429, e400, net]) expect(JSON.stringify(e) + String((e as Error).message)).not.toContain(API_KEY);
    expect((e400 as Dialog360ProviderError).provider).toBe("360dialog");
  });

  it("rejects a 200 without a message id", async () => {
    const p = new Dialog360Provider({ fetch: asFetch(mockFetch(json({ messages: [] }))) });
    await expect(p.sendText(conn, "+5491155551234", "a")).rejects.toMatchObject({ retryable: false });
  });
});

describe("downloadMedia", () => {
  it("re-roots the CDN url on the 360dialog host", async () => {
    const f = mockFetch(
      json({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&ext=2&hash=h" }),
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg; charset=x" } }),
    );
    const out = await new Dialog360Provider({ fetch: asFetch(f) }).downloadMedia(conn, { externalMediaId: "MEDIA123" });
    expect(Array.from(out.data)).toEqual([1, 2, 3]);
    expect(out.mimeType).toBe("image/jpeg");
    expect(call(f, 0).url).toBe("https://waba-v2.360dialog.io/MEDIA123");
    expect(call(f, 1).url).toBe("https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=1&ext=2&hash=h");
    expect((call(f, 1).init.headers as Record<string, string>)["D360-API-KEY"]).toBe(API_KEY);
  });

  it("rejects ids that could alter the request path", async () => {
    const p = new Dialog360Provider({ fetch: asFetch(mockFetch()) });
    await expect(p.downloadMedia(conn, { externalMediaId: "../etc" })).rejects.toBeInstanceOf(Dialog360ProviderError);
  });

  it("enforces the size limit", async () => {
    const f = mockFetch(json({ url: "https://x/y" }), new Response(new Uint8Array(100)));
    const p = new Dialog360Provider({ fetch: asFetch(f), maxMediaBytes: 10 });
    await expect(p.downloadMedia(conn, { externalMediaId: "M1" })).rejects.toThrow("size limit");
  });
});

describe("templates", () => {
  it("listTemplates maps status, category, body and reason", async () => {
    const f = mockFetch(
      json({
        waba_templates: [
          { name: "a", language: "es", status: "approved", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}}" }] },
          { name: "b", language: "es_AR", status: "rejected", category: "MARKETING", rejected_reason: "INVALID_FORMAT", components: [] },
        ],
      }),
    );
    const out = await new Dialog360Provider({ fetch: asFetch(f) }).listTemplates(conn);
    expect(out).toEqual([
      { externalId: "a|es", name: "a", language: "es", category: "utility", status: "approved", body: "Hola {{1}}" },
      { externalId: "b|es_AR", name: "b", language: "es_AR", category: "marketing", status: "rejected", body: "", reason: "INVALID_FORMAT" },
    ]);
  });

  it("submitTemplate posts components with samples and returns name|language", async () => {
    const f = mockFetch(json({ status: "PENDING", name: "a" }));
    const res = await new Dialog360Provider({ fetch: asFetch(f) }).submitTemplate(conn, {
      name: "a",
      language: "es",
      category: "utility",
      body: "Hola {{1}}, total {{2}}",
      example: "Hola Juan, total 100",
    });
    expect(res).toEqual({ externalId: "a|es", status: "pending" });
    expect(call(f).body).toMatchObject({
      name: "a",
      language: "es",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Hola {{1}}, total {{2}}", example: { body_text: [["Juan", "100"]] } }],
    });
  });

  it("parseTemplateExternalId", () => {
    expect(parseTemplateExternalId("a|es_AR")).toEqual({ name: "a", language: "es_AR" });
    expect(parseTemplateExternalId("nolang")).toBeUndefined();
    expect(parseTemplateExternalId("|es")).toBeUndefined();
  });
});

describe("RoutingWhatsAppProvider", () => {
  it("dispatches by connection provider and webhook header", async () => {
    const f = mockFetch(json({ messages: [{ id: "wamid.R" }] }));
    const router = new RoutingWhatsAppProvider({
      gupshup: new GupshupProvider(),
      "360dialog": new Dialog360Provider({ fetch: asFetch(f) }),
    });
    await router.sendText(conn, "+5491155551234", "x");
    expect(call(f).url).toBe("https://waba-v2.360dialog.io/messages");
    expect(router.parseWebhook(fixture("d360-text"), { [BSP_HEADER]: "360dialog" })[0]!.kind).toBe("message");
    expect(router.parseWebhook({ type: "user-event" }, {})[0]!.kind).toBe("ignored");
  });
});
