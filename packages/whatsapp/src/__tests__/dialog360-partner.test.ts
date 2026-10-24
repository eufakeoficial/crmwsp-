import { describe, expect, it, vi } from "vitest";
import { Dialog360PartnerClient, extractChannelPhone } from "../dialog360/partner.js";

const PARTNER_KEY = "partner_SECRET_key_abc";
const CHANNEL_KEY = "channel_SECRET_key_xyz";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(...responses: Array<Response | Error>) {
  const f = vi.fn(async (..._args: unknown[]) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  return { f, c: new Dialog360PartnerClient({ partnerId: "P1", partnerApiKey: PARTNER_KEY, fetch: f as unknown as typeof fetch }) };
}
const req = (f: ReturnType<typeof client>["f"], i = 0) => {
  const [url, init] = f.mock.calls[i] as unknown as [string, RequestInit];
  return { url, init };
};

describe("Dialog360PartnerClient", () => {
  it("creates the channel api key with the partner key", async () => {
    const { f, c } = client(json({ api_key: CHANNEL_KEY }));
    expect(await c.createChannelApiKey("CH1")).toBe(CHANNEL_KEY);
    const { url, init } = req(f);
    expect(url).toBe("https://hub.360dialog.com/api/v2/partners/P1/channels/CH1/api_keys");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(PARTNER_KEY);
  });

  it("does not leak credentials in errors", async () => {
    const { c } = client(json({ error: PARTNER_KEY }, 401));
    const err = await c.createChannelApiKey("CH1").catch((e: unknown) => e as Error);
    expect(err.message).not.toContain(PARTNER_KEY);
    expect(JSON.stringify(err)).not.toContain(PARTNER_KEY);
  });

  it("sets the webhook on the waba host with the channel key", async () => {
    const { f, c } = client(json({}));
    await c.setWebhook(CHANNEL_KEY, "https://api.example.com/webhooks/360dialog/tok");
    const { url, init } = req(f);
    expect(url).toBe("https://waba-v2.360dialog.io/v1/configs/webhook");
    expect((init.headers as Record<string, string>)["D360-API-KEY"]).toBe(CHANNEL_KEY);
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://api.example.com/webhooks/360dialog/tok" });
  });

  it("finds the phone when exposed and returns undefined otherwise (never throws)", async () => {
    const a = client(json({ partner_channels: [{ id: "CH1", setup_info: { display_phone_number: "+54 9 11 4000-0000" } }] }));
    expect(await a.c.findChannelPhone("CH1")).toBe("+5491140000000");
    expect(await client(json({ partner_channels: [{ id: "CH1" }] })).c.findChannelPhone("CH1")).toBeUndefined();
    expect(await client(new Error("down")).c.findChannelPhone("CH1")).toBeUndefined();
    expect(await client(json("nope", 500)).c.findChannelPhone("CH1")).toBeUndefined();
  });

  it("extractChannelPhone ignores short or non numeric values", () => {
    expect(extractChannelPhone({ phone: "123" })).toBeUndefined();
    expect(extractChannelPhone({ display_phone_number: "5491140000000" })).toBe("+5491140000000");
  });
});
