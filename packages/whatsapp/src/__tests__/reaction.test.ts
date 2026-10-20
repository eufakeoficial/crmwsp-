import { describe, expect, it, vi } from "vitest";
import { GupshupProvider } from "../gupshup/provider.js";
import type { WhatsAppConnection } from "../types.js";

const conn: WhatsAppConnection = { apiKey: "k_secret", appName: "DemoApp", sourcePhone: "+5491140000000" };
const provider = new GupshupProvider();

describe("sendReaction", () => {
  it("posts a session message of type reaction", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: "submitted", messageId: "gs-r" }), { status: 200 }));
    const p = new GupshupProvider({ fetch: f as unknown as typeof fetch, baseUrl: "https://example.test" });
    await expect(p.sendReaction(conn, { to: "+5491155551234", messageExternalId: "wamid.X", emoji: "👍" })).resolves.toEqual({ externalId: "gs-r" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/wa/api/v1/msg");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("destination")).toBe("5491155551234");
    expect(JSON.parse(form.get("message") ?? "{}")).toEqual({ type: "reaction", msgId: "wamid.X", emoji: "👍" });
  });
});

describe("inbound reactions", () => {
  it("v2 reaction becomes a reaction message targeting the reacted id", () => {
    const [r] = provider.parseWebhook(
      {
        app: "DemoApp",
        timestamp: 1729339200000,
        type: "message",
        payload: { id: "wamid.R1", source: "5491155551234", type: "reaction", payload: { emoji: "❤️", msgId: "wamid.T" } },
      },
      {},
    );
    expect(r).toMatchObject({ kind: "message", message: { type: "reaction", reaction: { targetExternalId: "wamid.T", emoji: "❤️" } } });
  });

  it("v2 reaction without a target stays unsupported", () => {
    const [r] = provider.parseWebhook(
      { timestamp: 1729339200000, type: "message", payload: { id: "wamid.R2", source: "5491155551234", type: "reaction", payload: { emoji: "👍" } } },
      {},
    );
    expect(r).toMatchObject({ kind: "message", message: { type: "unsupported" } });
  });

  it("v3 (Meta) reaction is parsed", () => {
    const [r] = provider.parseWebhook(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ id: "wamid.R3", from: "5491155551234", timestamp: "1729339200", type: "reaction", reaction: { message_id: "wamid.T", emoji: "😂" } }],
                },
              },
            ],
          },
        ],
      },
      {},
    );
    expect(r).toMatchObject({ kind: "message", message: { type: "reaction", reaction: { targetExternalId: "wamid.T", emoji: "😂" } } });
  });
});
