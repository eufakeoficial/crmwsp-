import { describe, expect, it, vi } from "vitest";
import { GupshupProvider } from "../gupshup/provider.js";
import { RoutingWhatsAppProvider } from "../router.js";
import type { WhatsAppConnection } from "../types.js";

const conn: WhatsAppConnection = {
  apiKey: "k_secret",
  appName: "DemoApp",
  sourcePhone: "+5491140000000",
  partnerAppId: "app-123",
  partnerToken: "sk_partner_secret",
};

function gupshup(f: ReturnType<typeof vi.fn>) {
  return new GupshupProvider({ fetch: f as unknown as typeof fetch, partnerBaseUrl: "https://partner.example.test" });
}

describe("Gupshup sendTypingIndicator", () => {
  it("posts a read + typing_indicator event to the Partner API", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: "success" }), { status: 200 }));
    await gupshup(f).sendTypingIndicator(conn, "wamid.IN1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://partner.example.test/partner/app/app-123/v1/event");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("sk_partner_secret");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "message-event",
      message: { messaging_product: "whatsapp", status: "read", message_id: "wamid.IN1", typing_indicator: { type: "text" } },
    });
  });

  it("is a no-op without partner credentials or message id", async () => {
    const f = vi.fn();
    const p = gupshup(f);
    const { partnerToken: _t, ...noToken } = conn;
    const { partnerAppId: _a, ...noApp } = conn;
    await p.sendTypingIndicator(noToken, "wamid.IN1");
    await p.sendTypingIndicator(noApp, "wamid.IN1");
    await p.sendTypingIndicator(conn, "");
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects on HTTP errors without leaking credentials", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 500 }));
    const err = await gupshup(f).sendTypingIndicator(conn, "wamid.IN1").catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("sk_partner_secret");
  });
});

describe("router sendTypingIndicator", () => {
  it("delegates to the adapter and no-ops when it lacks support", async () => {
    const spy = vi.fn(async () => undefined);
    const withIt = { name: "a", sendTypingIndicator: spy } as never;
    const without = { name: "b" } as never;
    const r = new RoutingWhatsAppProvider({ gupshup: withIt, "360dialog": without });
    await r.sendTypingIndicator({ ...conn, provider: "gupshup" }, "wamid.X");
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ provider: "gupshup" }), "wamid.X");
    await expect(r.sendTypingIndicator({ ...conn, provider: "360dialog" }, "wamid.X")).resolves.toBeUndefined();
  });
});
