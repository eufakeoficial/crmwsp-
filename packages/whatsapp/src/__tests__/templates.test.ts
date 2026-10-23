import { describe, expect, it, vi } from "vitest";
import { GupshupProvider, GupshupProviderError } from "../gupshup/provider.js";
import type { WhatsAppConnection } from "../types.js";

const API_KEY = "sk_live_SUPERSECRET_gupshup_key_123";
const PARTNER_TOKEN = "sk_partner_TOKEN_abc123";
const conn: WhatsAppConnection = { apiKey: API_KEY, appName: "Demo App", sourcePhone: "+5491140000000", partnerAppId: "app-uuid-1", partnerToken: PARTNER_TOKEN };

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}
const make = (f: ReturnType<typeof mockFetch>) => new GupshupProvider({ fetch: f as unknown as typeof fetch });

const capture = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected rejection");
};

describe("submitTemplate", () => {
  const tpl = { name: "promo_otono", language: "es", category: "marketing" as const, body: "Hola {{1}}, 20% off", example: "Hola Ana, 20% off" };

  it("posts the form to the app template endpoint with the apikey header", async () => {
    const f = mockFetch(200, { status: "success", template: { id: "tpl-1", elementName: "promo_otono", languageCode: "es", status: "PENDING" } });
    await expect(make(f).submitTemplate(conn, tpl)).resolves.toEqual({ externalId: "tpl-1", status: "pending" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://partner.gupshup.io/partner/app/app-uuid-1/templates");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe(PARTNER_TOKEN);
    const form = new URLSearchParams(init?.body as string);
    expect(form.get("elementName")).toBe("promo_otono");
    expect(form.get("languageCode")).toBe("es");
    expect(form.get("category")).toBe("MARKETING");
    expect(form.get("content")).toBe("Hola {{1}}, 20% off");
    expect(form.get("example")).toBe("Hola Ana, 20% off");
    expect(form.toString()).not.toContain(PARTNER_TOKEN);
    expect((init?.headers as Record<string, string>).apikey).toBeUndefined();
    expect(init?.redirect).toBe("error");
  });

  it("falls back to the body as example", async () => {
    const f = mockFetch(200, { status: "success", template: { id: "t", elementName: "a", languageCode: "es", status: "APPROVED" } });
    const { example: _e, ...noExample } = tpl;
    await make(f).submitTemplate(conn, noExample);
    expect(new URLSearchParams(f.mock.calls[0]![1]?.body as string).get("example")).toBe(tpl.body);
  });

  it("logical rejection (200 + status error) is non-retryable and leaks nothing", async () => {
    const f = mockFetch(200, { status: "error", message: `bad ${PARTNER_TOKEN}` });
    const e = (await capture(() => make(f).submitTemplate(conn, tpl))) as GupshupProviderError;
    expect(e).toBeInstanceOf(GupshupProviderError);
    expect(e.retryable).toBe(false);
    expect(JSON.stringify(e, Object.getOwnPropertyNames(e)) + String(e)).not.toContain(PARTNER_TOKEN);
  });

  it("HTTP 503 is retryable", async () => {
    const e = (await capture(() => make(mockFetch(503, {})).submitTemplate(conn, tpl))) as GupshupProviderError;
    expect(e.retryable).toBe(true);
    expect(e.status).toBe(503);
  });

  it("network failure does not echo the credential", async () => {
    const f = vi.fn(async () => {
      throw new TypeError(`fetch failed authorization=${PARTNER_TOKEN}`);
    });
    const e = await capture(() => make(f as unknown as ReturnType<typeof mockFetch>).submitTemplate(conn, tpl));
    expect(JSON.stringify(e, Object.getOwnPropertyNames(e as object)) + String(e) + String((e as Error).stack)).not.toContain(PARTNER_TOKEN);
  });
});

describe("partner credentials", () => {
  const { partnerAppId: _a, partnerToken: _t, ...bare } = conn;
  it("refuses to call Gupshup without appId/token (non-retryable, no request)", async () => {
    const f = mockFetch(200, {});
    for (const c of [bare, { ...bare, partnerAppId: "x" }, { ...bare, partnerToken: "y" }]) {
      const e = (await capture(() => make(f).listTemplates(c))) as GupshupProviderError;
      expect(e).toBeInstanceOf(GupshupProviderError);
      expect(e.retryable).toBe(false);
    }
    await capture(() => make(f).submitTemplate(bare, { name: "a", language: "es", category: "utility", body: "x" }));
    expect(f).not.toHaveBeenCalled();
  });

  it("partnerBaseUrl is overridable and the app id is url-encoded", async () => {
    const f = mockFetch(200, { status: "success", templates: [] });
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch, partnerBaseUrl: "https://example.test/" });
    await p.listTemplates({ ...conn, partnerAppId: "a/b" });
    expect(f.mock.calls[0]![0]).toBe("https://example.test/partner/app/a%2Fb/templates");
  });
});

describe("listTemplates", () => {
  it("maps rows, statuses and categories", async () => {
    const f = mockFetch(200, {
      status: "success",
      templates: [
        { id: "a", elementName: "t_ok", languageCode: "es", category: "UTILITY", status: "APPROVED", data: "Hola {{1}}" },
        { id: "b", elementName: "t_no", languageCode: "es_AR", category: "MARKETING", status: "REJECTED", data: "x", reason: "INVALID_FORMAT" },
        { id: "c", elementName: "t_pa", languageCode: "en_US", category: "AUTHENTICATION", status: "PAUSED" },
        { id: "d", elementName: "t_new", languageCode: "es", status: "SOMETHING_NEW" },
      ],
    });
    const out = await make(f).listTemplates(conn);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://partner.gupshup.io/partner/app/app-uuid-1/templates");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).authorization).toBe(PARTNER_TOKEN);
    expect(out).toEqual([
      { externalId: "a", name: "t_ok", language: "es", category: "utility", status: "approved", body: "Hola {{1}}" },
      { externalId: "b", name: "t_no", language: "es_AR", category: "marketing", status: "rejected", body: "x", reason: "INVALID_FORMAT" },
      { externalId: "c", name: "t_pa", language: "en_US", category: "authentication", status: "paused", body: "" },
      { externalId: "d", name: "t_new", language: "es", category: "marketing", status: "pending", body: "" },
    ]);
  });

  it("empty list", async () => {
    await expect(make(mockFetch(200, { status: "success" })).listTemplates(conn)).resolves.toEqual([]);
  });

  it("unexpected payload throws non-retryable", async () => {
    const e = (await capture(() => make(mockFetch(200, { status: "error" })).listTemplates(conn))) as GupshupProviderError;
    expect(e.retryable).toBe(false);
  });

  it("429 is retryable", async () => {
    const e = (await capture(() => make(mockFetch(429, {})).listTemplates(conn))) as GupshupProviderError;
    expect(e.retryable).toBe(true);
  });
});
