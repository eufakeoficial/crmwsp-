import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GupshupProvider } from "../gupshup/provider.js";
import { parseReferral } from "../gupshup/parse.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const provider = new GupshupProvider();

describe("Click-to-WhatsApp referral", () => {
  it("v3: maps the Meta referral onto the normalized message", () => {
    const [r] = provider.parseWebhook(fixture("v3-ctwa-referral"), {});
    expect(r?.kind).toBe("message");
    if (r?.kind !== "message") return;
    expect(r.message.referral).toEqual({
      sourceId: "120210000000001",
      sourceType: "ad",
      sourceUrl: "https://fb.me/abc123",
      headline: "Zapatillas -20%",
      body: "Solo esta semana",
      mediaType: "image",
      ctwaClid: expect.stringMatching(/^ARAkLkA8/) as unknown as string,
    });
    expect(r.message.text).toBe("Hola, vi el anuncio");
  });

  it("v2: reads referral from the message payload and from the content payload", () => {
    const base = fixture("v2-text") as { payload: Record<string, unknown> & { payload: Record<string, unknown> } };
    const outer = structuredClone(base);
    outer.payload.referral = { source_id: "AD-1", ctwa_clid: "clid-1", source_type: "ad" };
    const [a] = provider.parseWebhook(outer, {});
    expect(a?.kind === "message" && a.message.referral).toEqual({ sourceId: "AD-1", ctwaClid: "clid-1", sourceType: "ad" });

    const inner = structuredClone(base);
    inner.payload.payload.referral = { source_id: "AD-2", headline: "H" };
    const [b] = provider.parseWebhook(inner, {});
    expect(b?.kind === "message" && b.message.referral).toEqual({ sourceId: "AD-2", headline: "H" });
  });

  it("messages without referral carry none", () => {
    const [r] = provider.parseWebhook(fixture("v2-text"), {});
    expect(r?.kind === "message" && r.message.referral).toBeUndefined();
  });

  it("ignores referrals that identify neither the ad nor the click, or are malformed", () => {
    expect(parseReferral({ headline: "x", source_url: "https://a" })).toBeUndefined();
    expect(parseReferral({ source_id: "   " })).toBeUndefined();
    expect(parseReferral("nope")).toBeUndefined();
    expect(parseReferral({ source_id: 42 })).toBeUndefined();
    expect(parseReferral({ source_id: "x".repeat(300) })).toBeUndefined();
    expect(parseReferral({ ctwa_clid: " c " })).toEqual({ ctwaClid: "c" });
  });
});
