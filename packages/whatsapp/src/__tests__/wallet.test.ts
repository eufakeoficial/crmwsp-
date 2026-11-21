import { describe, expect, it, vi } from "vitest";
import { GupshupProvider, parseWalletBalance } from "../index.js";

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

const CREDS = { appId: "app id/1", partnerToken: "sk_partner_token_9999" };

describe("GupshupProvider.getWalletBalanceViaPartner", () => {
  it("calls the Partner wallet endpoint with the token in Authorization and parses walletResponse", async () => {
    const f = respond(200, JSON.stringify({ status: "success", walletResponse: { currency: "USD", currentBalance: 4.25, overDraftLimit: 0 } }));
    expect(await provider(f).getWalletBalanceViaPartner(CREDS)).toEqual({ amount: 4.25, currency: "USD" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://partner.gupshup.io/partner/app/app%20id%2F1/wallet/balance");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(CREDS.partnerToken);
    expect(init.redirect).toBe("error");
  });

  it("401, malformed body, invalid JSON and network errors return null without throwing", async () => {
    expect(await provider(respond(401, "Unauthorized")).getWalletBalanceViaPartner(CREDS)).toBeNull();
    expect(await provider(respond(200, JSON.stringify({ status: "success" }))).getWalletBalanceViaPartner(CREDS)).toBeNull();
    expect(await provider(respond(200, JSON.stringify({ walletResponse: { currentBalance: "n/a" } }))).getWalletBalanceViaPartner(CREDS)).toBeNull();
    expect(await provider(respond(200, "<html>")).getWalletBalanceViaPartner(CREDS)).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error(`connect failed for ${CREDS.partnerToken}`);
    });
    expect(await provider(boom).getWalletBalanceViaPartner(CREDS)).toBeNull();
  });
});
