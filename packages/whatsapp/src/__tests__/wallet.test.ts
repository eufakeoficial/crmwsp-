import { describe, expect, it, vi } from "vitest";
import { GupshupProvider, parseWalletBalance } from "../index.js";

const KEY = "sk_wallet_test_12345678";
const provider = (fetchFn: unknown) => new GupshupProvider({ fetch: fetchFn as typeof fetch });
const respond = (status: number, body: string) => vi.fn(async () => new Response(body, { status }));

describe("parseWalletBalance", () => {
  it.each([
    [{ balance: 4.8, currency: "USD" }, { amount: 4.8, currency: "USD" }],
    [{ balance: "12.50", currency: "usd" }, { amount: 12.5, currency: "USD" }],
    [{ status: "success", data: { walletBalance: 7, currencyCode: "EUR" } }, { amount: 7, currency: "EUR" }],
    [{ balance: 3 }, { amount: 3, currency: null }],
  ])("%j", (body, expected) => {
    expect(parseWalletBalance(body)).toEqual(expected);
  });

  it.each([null, "x", [], {}, { balance: "n/a" }, { status: "ok", items: [1, 2] }])("unknown shape %j -> null", (body) => {
    expect(parseWalletBalance(body)).toBeNull();
  });
});

describe("GupshupProvider.getWalletBalance", () => {
  it("calls the v2 wallet endpoint with the apikey header", async () => {
    const f = respond(200, JSON.stringify({ balance: 1.5, currency: "USD" }));
    expect(await provider(f).getWalletBalance(KEY)).toEqual({ amount: 1.5, currency: "USD" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.gupshup.io/sm/api/v2/wallet/balance");
    expect((init.headers as Record<string, string>)["apikey"]).toBe(KEY);
    expect(init.redirect).toBe("error");
  });

  it("401 (invalid key), unknown shape, invalid JSON and network errors all return null without throwing", async () => {
    expect(await provider(respond(401, "Portal User Not Found With APIKey")).getWalletBalance(KEY)).toBeNull();
    expect(await provider(respond(200, JSON.stringify({ hello: "world" }))).getWalletBalance(KEY)).toBeNull();
    expect(await provider(respond(200, "<html>")).getWalletBalance(KEY)).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error(`connect failed for ${KEY}`);
    });
    expect(await provider(boom).getWalletBalance(KEY)).toBeNull();
  });
});
