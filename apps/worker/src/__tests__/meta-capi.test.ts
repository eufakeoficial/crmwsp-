import { createHash, randomBytes } from "node:crypto";
import { createCipherBox } from "@crmwsp/crypto";
import { META_CAPI_TOKEN_PURPOSE } from "@crmwsp/contracts";
import { CAPI_MAX_ATTEMPTS } from "@crmwsp/domain";
import { describe, expect, it, vi } from "vitest";
import {
  META_GRAPH_API_VERSION,
  buildServerEvent,
  capiEventsUrl,
  sendCapiEvent,
  type FetchLike,
} from "../meta-capi/client.js";
import { nextState, runCapiTick, type CapiOutcome, type CapiStore, type DueCapiEvent } from "../meta-capi/tick.js";

const TOKEN = "EAAB_SUPERSECRET_meta_token_1234567890";
const dest = { datasetId: "123456789012345", accessToken: TOKEN, testEventCode: null };
const lead: DueCapiEvent = {
  rowId: "r1",
  attempts: 0,
  eventId: "lead:a1",
  eventName: "Lead",
  eventTime: new Date("2026-10-20T10:00:00Z"),
  phoneE164: "+5491155550000",
  ctwaClid: "clid-1",
};
const okFetch = (): ReturnType<typeof vi.fn<FetchLike>> => vi.fn<FetchLike>(async () => ({ status: 200, text: async () => "{}" }));

describe("Conversions API client", () => {
  it("uses the single Graph API version constant", () => {
    expect(capiEventsUrl("123456")).toBe(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/123456/events`);
    expect(() => capiEventsUrl("../x")).toThrow();
  });

  it("builds a business_messaging event with hashed phone and ctwa_clid", () => {
    const ev = buildServerEvent({ ...lead, eventName: "Purchase", eventId: "purchase:o1", value: { amountMinor: 12345, currency: "EUR" } });
    expect(ev).toEqual({
      event_name: "Purchase",
      event_time: 1792490400,
      event_id: "purchase:o1",
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: { ph: [createHash("sha256").update("5491155550000").digest("hex")], ctwa_clid: "clid-1" },
      custom_data: { currency: "EUR", value: 123.45 },
    });
  });

  it("sends the token in the body, never in the URL", async () => {
    const f = okFetch();
    expect(await sendCapiEvent(f, { ...dest, testEventCode: "TEST1" }, lead)).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0]!;
    expect(url).not.toContain(TOKEN);
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body["access_token"]).toBe(TOKEN);
    expect(body["test_event_code"]).toBe("TEST1");
  });

  it("reduces errors to status and Meta code, without the token or request", async () => {
    const f: FetchLike = async () => ({ status: 400, text: async () => JSON.stringify({ error: { code: 100, error_subcode: 2804, message: `bad ${TOKEN}` } }) });
    const r = await sendCapiEvent(f, dest, lead);
    expect(r).toEqual({ ok: false, status: 400, error: "http_400:meta_100.2804" });
    const net: FetchLike = async () => {
      throw new TypeError(`fetch failed ${TOKEN}`);
    };
    expect(await sendCapiEvent(net, dest, lead)).toEqual({ ok: false, status: 0, error: "network:TypeError" });
  });
});

describe("retry state machine", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  it("sent is final; retryable failures back off; permanent or exhausted failures die", () => {
    expect(nextState(0, { ok: true }, now).status).toBe("sent");
    const r = nextState(0, { ok: false, status: 503, error: "http_503" }, now);
    expect(r).toMatchObject({ status: "pending", attempts: 1, lastError: "http_503" });
    expect(r.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
    expect(nextState(0, { ok: false, status: 400, error: "http_400" }, now).status).toBe("dead");
    expect(nextState(CAPI_MAX_ATTEMPTS - 1, { ok: false, status: 503, error: "x" }, now).status).toBe("dead");
  });
});

describe("runCapiTick", () => {
  const keys = new Map([[1, randomBytes(32)]]);
  const cipher = createCipherBox({ keys, activeKeyId: 1 });
  const tenantId = "11111111-1111-4111-8111-111111111111";

  function fakeStore(due: DueCapiEvent[]) {
    const applied: CapiOutcome[] = [];
    const store: CapiStore = {
      enqueueCandidates: async () => due.length,
      loadDestination: async () => ({
        datasetId: dest.datasetId,
        accessTokenEncrypted: cipher.encrypt(TOKEN, { tenantId, purpose: META_CAPI_TOKEN_PURPOSE }),
        testEventCode: null,
      }),
      loadDue: async () => due,
      applyOutcomes: async (o) => {
        applied.push(...o);
      },
    };
    return { store, applied };
  }

  it("decrypts with the tenant-bound purpose, sends due events and records outcomes", async () => {
    const { store, applied } = fakeStore([lead, { ...lead, rowId: "r2", eventId: "lead:a2" }]);
    let n = 0;
    const f = vi.fn<FetchLike>(async () => (n++ === 0 ? { status: 200, text: async () => "" } : { status: 500, text: async () => "" }));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const res = await runCapiTick({
      db: {} as never,
      cipher,
      fetch: f,
      logger,
      listTenants: async () => [tenantId],
      inTenant: async (_t, fn) => fn(store),
    });
    expect(res).toEqual({ tenants: 1, created: 2, sent: 1, failed: 1, failedTenants: 0 });
    expect(applied.map((a) => a.result.ok)).toEqual([true, false]);
    for (const call of [...logger.warn.mock.calls, ...logger.info.mock.calls]) expect(String(call[0])).not.toContain(TOKEN);
  });

  it("isolates a failing tenant and never logs secrets", async () => {
    const { store } = fakeStore([lead]);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const res = await runCapiTick({
      db: {} as never,
      cipher,
      fetch: okFetch(),
      logger,
      listTenants: async () => ["bad", tenantId],
      inTenant: async (t, fn) => {
        if (t === "bad") throw new Error(`boom ${TOKEN}`);
        return fn(store);
      },
    });
    expect(res).toMatchObject({ tenants: 2, sent: 1, failedTenants: 1 });
    expect(String(logger.warn.mock.calls[0]?.[0])).not.toContain(TOKEN);
  });

  it("skips tenants without due events (no network call)", async () => {
    const { store } = fakeStore([]);
    const f = okFetch();
    await runCapiTick({ db: {} as never, cipher, fetch: f, listTenants: async () => [tenantId], inTenant: async (_t, fn) => fn(store) });
    expect(f).not.toHaveBeenCalled();
  });
});
