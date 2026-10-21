import { randomBytes } from "node:crypto";
import { createCipherBox } from "@crmwsp/crypto";
import { META_ADS_GRAPH_API_VERSION, META_ADS_TOKEN_PURPOSE } from "@crmwsp/contracts";
import { describe, expect, it, vi } from "vitest";
import { META_GRAPH_API_VERSION } from "../meta-capi/client.js";
import { META_MAX_ATTEMPTS, fetchInsights, insightsUrl, metaGet, parseInsightRow, safeNextUrl, type InsightRow, type MetaGetFetch } from "./client.js";
import { runMetaAdsTick, syncMetaAdsTenant, type MetaAdsStore } from "./sync.js";

const TOKEN = "EAAB_SUPERSECRET_marketing_token_1234567890";
const TENANT = "11111111-1111-4111-8111-111111111111";
const res = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
const row = (adId: string, date: string, spend = "10.50") => ({
  ad_id: adId,
  ad_name: `Ad ${adId}`,
  adset_id: "s1",
  adset_name: "Set 1",
  campaign_id: "c1",
  campaign_name: "Camp 1",
  spend,
  impressions: "1000",
  clicks: "25",
  actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "3" }],
  account_currency: "EUR",
  date_start: date,
});
const noSleep = vi.fn(async () => {});

describe("Marketing API client", () => {
  it("shares the Graph API version with the Conversions API client", () => {
    expect(META_ADS_GRAPH_API_VERSION).toBe(META_GRAPH_API_VERSION);
    const url = insightsUrl("act_123");
    expect(url.startsWith(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/act_123/insights?`)).toBe(true);
    expect(url).toContain("time_increment=1");
    expect(url).toContain("level=ad");
    expect(url).toContain("date_preset=last_30d");
    expect(() => insightsUrl("123/../x")).toThrow();
  });

  it("parses a row into minor units and Meta messaging conversations", () => {
    expect(parseInsightRow(row("a1", "2026-10-01"), null)).toEqual({
      adId: "a1",
      date: "2026-10-01",
      spendMinor: 1050,
      currency: "EUR",
      impressions: 1000,
      clicks: 25,
      metaConversations: 3,
      adName: "Ad a1",
      adsetId: "s1",
      adsetName: "Set 1",
      campaignId: "c1",
      campaignName: "Camp 1",
    });
    expect(parseInsightRow({ ad_id: "x" }, "EUR")).toBeNull();
  });

  it("only follows next pages on the Graph host and strips any token", () => {
    expect(safeNextUrl("https://evil.example/x")).toBeNull();
    expect(safeNextUrl(`https://graph.facebook.com/v23.0/act_1/insights?after=abc&access_token=${TOKEN}`)).toBe("https://graph.facebook.com/v23.0/act_1/insights?after=abc");
  });

  it("paginates and sends the token only in the Authorization header", async () => {
    const f = vi.fn<MetaGetFetch>(async (url) =>
      url.includes("after=p2")
        ? res(200, { data: [row("a2", "2026-10-02")], paging: {} })
        : res(200, { data: [row("a1", "2026-10-01")], paging: { next: "https://graph.facebook.com/v23.0/act_1/insights?after=p2" } }),
    );
    const rows = await fetchInsights({ fetch: f, sleep: noSleep }, "act_1", TOKEN, null);
    expect(rows.map((r) => r.adId)).toEqual(["a1", "a2"]);
    expect(f).toHaveBeenCalledTimes(2);
    for (const [url, init] of f.mock.calls) {
      expect(url).not.toContain(TOKEN);
      expect(init.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("retries rate limits (17 / 613) with backoff, then succeeds", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let n = 0;
    const f: MetaGetFetch = async () => {
      n++;
      if (n === 1) return res(400, { error: { code: 17, message: "User request limit reached" } });
      if (n === 2) return res(400, { error: { code: 613, message: "Calls within one hour" } });
      return res(200, { data: [] });
    };
    expect(await metaGet({ fetch: f, sleep }, insightsUrl("act_1"), TOKEN)).toEqual({ data: [] });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000]);
  });

  it("gives up after the max attempts and never leaks the token in the error", async () => {
    const f = vi.fn<MetaGetFetch>(async () => res(400, { error: { code: 17, message: `limit for ${TOKEN}` } }));
    const err = (await metaGet({ fetch: f, sleep: noSleep }, insightsUrl("act_1"), TOKEN).catch((e: unknown) => e)) as Error;
    expect(f).toHaveBeenCalledTimes(META_MAX_ATTEMPTS);
    expect(err.message).toBe("http_400:meta_17");
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it("does not retry an invalid token (190)", async () => {
    const f = vi.fn<MetaGetFetch>(async () => res(401, { error: { code: 190, error_subcode: 463, message: TOKEN } }));
    const err = (await metaGet({ fetch: f, sleep: noSleep }, insightsUrl("act_1"), TOKEN).catch((e: unknown) => e)) as Error;
    expect(f).toHaveBeenCalledTimes(1);
    expect(err.message).toBe("http_401:meta_190.463");
  });
});

function fakeStore(encrypted: Buffer | null) {
  const upserts: InsightRow[] = [];
  const results: unknown[] = [];
  const store: MetaAdsStore = {
    loadConnection: async () => (encrypted ? { adAccountId: "act_1", currency: "EUR", accessTokenEncrypted: encrypted } : null),
    upsertDaily: async (_acc, rows) => {
      upserts.push(...rows);
    },
    recordResult: async (r) => {
      results.push(r);
    },
  };
  return { store, upserts, results };
}

describe("Meta Ads sync", () => {
  const cipher = createCipherBox({ keys: new Map([[1, randomBytes(32)]]), activeKeyId: 1 });
  const encrypted = cipher.encrypt(TOKEN, { tenantId: TENANT, purpose: META_ADS_TOKEN_PURPOSE });

  it("upserts the fetched rows and records success", async () => {
    const { store, upserts, results } = fakeStore(encrypted);
    const f: MetaGetFetch = async () => res(200, { data: [row("a1", "2026-10-01"), row("a1", "2026-10-02", "3")] });
    const r = await syncMetaAdsTenant({ db: {} as never, cipher, fetch: f, sleep: noSleep, inTenant: (_t, fn) => fn(store) }, TENANT);
    expect(r).toEqual({ status: "ok", rows: 2 });
    expect(upserts.map((u) => u.spendMinor)).toEqual([1050, 300]);
    expect(results).toEqual([{ ok: true, currency: "EUR" }]);
  });

  it("records a sanitized error without the token", async () => {
    const { store, upserts, results } = fakeStore(encrypted);
    const f: MetaGetFetch = async () => res(400, { error: { code: 100, message: `bad ${TOKEN}` } });
    const r = await syncMetaAdsTenant({ db: {} as never, cipher, fetch: f, sleep: noSleep, inTenant: (_t, fn) => fn(store) }, TENANT);
    expect(r).toEqual({ status: "error", error: "http_400:meta_100" });
    expect(upserts).toEqual([]);
    expect(JSON.stringify(results)).not.toContain(TOKEN);
  });

  it("the tick keeps going when one tenant fails", async () => {
    const good = fakeStore(encrypted);
    const other = "22222222-2222-4222-8222-222222222222";
    const f: MetaGetFetch = async () => res(200, { data: [row("a1", "2026-10-01")] });
    const r = await runMetaAdsTick({
      db: {} as never,
      cipher,
      fetch: f,
      sleep: noSleep,
      listTenants: async () => [other, TENANT],
      inTenant: async (t, fn) => {
        if (t === other) throw new Error("boom");
        return fn(good.store);
      },
    });
    expect(r).toEqual({ tenants: 2, ok: 1, failed: 1 });
  });
});
