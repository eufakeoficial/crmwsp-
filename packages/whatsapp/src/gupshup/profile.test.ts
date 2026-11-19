import { describe, expect, it, vi } from "vitest";
import { GupshupProfileClient, GupshupProfileError } from "./profile.js";

const creds = { appId: "app-1", token: "SECRET_PARTNER_TOKEN" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const photo = { data: new Uint8Array([1, 2, 3]), mime: "image/png", filename: "a.png" };

describe("GupshupProfileClient", () => {
  it("reads details, about and photo with the partner token and no redirects", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/about")) return json({ status: "success", about: { message: "Hola" } });
      if (url.endsWith("/photo")) return json({ status: "success", message: "https://img/p.jpg" });
      return json({ status: "success", profile: { address: "Calle 1", profileEmail: "a@b.co", desc: "D", vertical: "RETAIL", website1: "https://x.co" } });
    });
    const out = await new GupshupProfileClient({ fetch: fetch as never }).getProfile(creds);
    expect(out).toMatchObject({ about: "Hola", photoUrl: "https://img/p.jpg", address: "Calle 1", email: "a@b.co", description: "D", vertical: "RETAIL", website2: null });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://partner.gupshup.io/partner/app/app-1/business/profile");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("SECRET_PARTNER_TOKEN");
    expect(init.redirect).toBe("error");
  });

  it("degrades about/photo failures to null", async () => {
    const fetch = vi.fn(async (url: string) => (url.endsWith("/business/profile") ? json({ status: "success", profile: {} }) : json({}, 500)));
    const out = await new GupshupProfileClient({ fetch: fetch as never }).getProfile(creds);
    expect(out.about).toBeNull();
    expect(out.photoUrl).toBeNull();
  });

  it("sends only provided fields, form-encoded, about on its own endpoint", async () => {
    const fetch = vi.fn(async () => json({ status: "success" }));
    await new GupshupProfileClient({ fetch: fetch as never }).updateProfile(creds, { description: "Desc", email: "a@b.co", about: "Sobre" });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [u1, i1] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(i1.method).toBe("PUT");
    expect(u1).toMatch(/\/business\/profile$/);
    expect(Object.fromEntries(new URLSearchParams(i1.body as string))).toEqual({ desc: "Desc", profileEmail: "a@b.co" });
    const [u2, i2] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(u2).toMatch(/\/business\/profile\/about$/);
    expect(new URLSearchParams(i2.body as string).get("about")).toBe("Sobre");
  });

  it("uploads the photo as multipart PUT", async () => {
    const fetch = vi.fn(async () => json({ status: "success", message: "profile picture updated successfully" }));
    await new GupshupProfileClient({ fetch: fetch as never }).updatePhoto(creds, photo);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/business\/profile\/photo$/);
    expect(init.method).toBe("PUT");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("image")).toBeInstanceOf(Blob);
  });

  it("posts the display name request", async () => {
    const fetch = vi.fn(async () => json({ status: "success" }));
    await new GupshupProfileClient({ fetch: fetch as never }).requestDisplayName(creds, "Mi Negocio");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/profile\/displayName$/);
    expect(new URLSearchParams(init.body as string).get("newDisplayName")).toBe("Mi Negocio");
  });

  it("maps errors to Spanish messages without leaking the token", async () => {
    const c = (status: number) => new GupshupProfileClient({ fetch: (async () => json({ message: "x" }, status)) as never });
    await expect(c(401).getProfile(creds)).rejects.toThrow(/Token de Partner/);
    await expect(c(400).updatePhoto(creds, photo)).rejects.toThrow(/imagen/);
    await expect(c(429).requestDisplayName(creds, "Nombre")).rejects.toThrow(/por hoy/);
    const err = await c(500).getProfile(creds).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GupshupProfileError);
    expect(JSON.stringify(err)).not.toContain("SECRET_PARTNER_TOKEN");
  });

  it("maps network failures and unconfirmed success", async () => {
    const down = new GupshupProfileClient({
      fetch: (async () => {
        throw new Error("boom SECRET_PARTNER_TOKEN");
      }) as never,
    });
    const e = await down.getProfile(creds).catch((x: unknown) => x as Error);
    expect(e.message).toMatch(/conectar/);
    expect(e.message).not.toContain("SECRET");
    const odd = new GupshupProfileClient({ fetch: (async () => json({ status: "error" })) as never });
    await expect(odd.requestDisplayName(creds, "Nombre")).rejects.toThrow(/no confirmó/);
  });
});
