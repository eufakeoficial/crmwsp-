import { describe, expect, it, vi } from "vitest";
import { NowPaymentsBalanceClient, balanceOptionsFromEnv, parseBalance } from "./nowpayments-balance.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("balanceOptionsFromEnv", () => {
  it("requires api key, email and password", () => {
    expect(balanceOptionsFromEnv({ NOWPAYMENTS_API_KEY: "k" })).toBeNull();
    expect(balanceOptionsFromEnv({ NOWPAYMENTS_API_KEY: "k", NOWPAYMENTS_EMAIL: "a@b.c", NOWPAYMENTS_PASSWORD: "p" })).toMatchObject({ apiKey: "k" });
  });
});

describe("parseBalance", () => {
  it("keeps valid currencies and skips junk", () => {
    expect(parseBalance({ usdtbsc: { amount: 12.5, pendingAmount: 1 }, eth: { amount: "0.001" }, "bad key": { amount: 1 }, x: null })).toEqual([
      { currency: "eth", amount: "0.001", pendingAmount: "0" },
      { currency: "usdtbsc", amount: "12.5", pendingAmount: "1" },
    ]);
    expect(parseBalance([])).toEqual([]);
  });
});

describe("NowPaymentsBalanceClient", () => {
  const opts = { apiKey: "key", email: "ops@example.com", password: "secret" };

  it("authenticates with email/password, sends api key + bearer, caches 60 s", async () => {
    let t = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth")) {
        expect(JSON.parse(String(init?.body))).toEqual({ email: "ops@example.com", password: "secret" });
        return json(200, { token: "jwt1" });
      }
      const h = init?.headers as Record<string, string>;
      expect(h["x-api-key"]).toBe("key");
      expect(h["authorization"]).toBe("Bearer jwt1");
      return json(200, { usdtbsc: { amount: 3, pendingAmount: 0 } });
    });
    const c = new NowPaymentsBalanceClient({ ...opts, fetch: fetchFn as typeof fetch, now: () => t });
    const r = await c.balance();
    expect(r).toMatchObject({ configured: true, ok: true, items: [{ currency: "usdtbsc", amount: "3" }] });
    t = 30_000;
    await c.balance();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    t = 61_000;
    await c.balance();
    expect(fetchFn).toHaveBeenCalledTimes(3); // JWT reused (4 min), one balance call
  });

  it("manual refresh bypasses the cache but not within 10 s", async () => {
    let t = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request) => (String(url).endsWith("/auth") ? json(200, { token: "j" }) : json(200, {})));
    const c = new NowPaymentsBalanceClient({ ...opts, fetch: fetchFn as typeof fetch, now: () => t });
    await c.balance();
    t = 5_000;
    await c.balance(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    t = 11_000;
    await c.balance(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("reports auth_failed without leaking anything", async () => {
    const fetchFn = vi.fn(async () => json(401, { message: "bad" }));
    const c = new NowPaymentsBalanceClient({ ...opts, fetch: fetchFn as typeof fetch });
    const r = await c.balance();
    expect(r).toMatchObject({ configured: true, ok: false, error: "auth_failed" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("reports unavailable on network errors", async () => {
    const c = new NowPaymentsBalanceClient({ ...opts, fetch: (async () => Promise.reject(new TypeError("net"))) as typeof fetch });
    expect(await c.balance()).toMatchObject({ ok: false, error: "unavailable" });
  });
});
