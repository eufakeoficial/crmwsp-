import { describe, expect, it, vi } from "vitest";
import { listMetaAdAccounts, type MetaGetFetch } from "./meta-ads.client.js";

const TOKEN = "EAAB_SUPERSECRET_marketing_token_1234567890";
const res = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });

describe("listMetaAdAccounts", () => {
  it("lists accounts across pages with the token only in the Authorization header", async () => {
    const f = vi.fn<MetaGetFetch>(async (url) =>
      url.includes("after=2")
        ? res(200, { data: [{ id: "act_2", name: "Dos", currency: "USD", account_status: 2 }] })
        : res(200, {
            data: [{ id: "act_1", name: "Uno", currency: "EUR", account_status: 1 }, { id: "bogus" }],
            paging: { next: `https://graph.facebook.com/v23.0/me/adaccounts?after=2&access_token=${TOKEN}` },
          }),
    );
    expect(await listMetaAdAccounts(f, TOKEN)).toEqual([
      { id: "act_1", name: "Uno", currency: "EUR", active: true },
      { id: "act_2", name: "Dos", currency: "USD", active: false },
    ]);
    for (const [url, init] of f.mock.calls) {
      expect(url).not.toContain(TOKEN);
      expect(init.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("does not follow pagination off the Graph host", async () => {
    const f = vi.fn<MetaGetFetch>(async () => res(200, { data: [], paging: { next: "https://evil.example/x" } }));
    await listMetaAdAccounts(f, TOKEN);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("reduces failures to status and Meta code, never the token", async () => {
    const f: MetaGetFetch = async () => res(400, { error: { code: 190, message: `invalid ${TOKEN}` } });
    const err = (await listMetaAdAccounts(f, TOKEN).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe("Meta rejected the request (http_400:meta_190)");
    expect(JSON.stringify(err) + err.message).not.toContain(TOKEN);
  });
});
