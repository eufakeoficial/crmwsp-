import type { Database } from "@crmwsp/db";
import { describe, expect, it, vi } from "vitest";
import { POLICY_USER_AGENT, policyTextHash, runPolicyMonitor, type PolicyFetch } from "../policy-monitor/index.js";

type Snap = { content_hash: string; content: string; etag: string | null };

/** In-memory stand-in for policy_monitor_last / policy_monitor_record / platform_alert_recipients. */
function fakeDb(initial: Record<string, Snap> = {}) {
  const snaps = { ...initial };
  const changes: string[] = [];
  const text = (q: unknown) => JSON.stringify(q);
  const params = (q: unknown): unknown[] =>
    ((q as { queryChunks: unknown[] }).queryChunks ?? []).filter((c) => typeof c !== "object" || c === null || !("value" in (c as object)));
  const db = {
    execute: vi.fn(async (q: unknown) => {
      const s = text(q);
      const p = params(q);
      if (s.includes("policy_monitor_last")) {
        const snap = snaps[p[0] as string];
        return snap ? [snap] : [];
      }
      if (s.includes("policy_monitor_record")) {
        const [key, , hash, content, etag] = p as [string, string, string, string, string | null];
        const had = Boolean(snaps[key]);
        snaps[key] = { content_hash: hash, content, etag };
        if (had) changes.push(key);
        return [{ id: had ? "chg-1" : null }];
      }
      if (s.includes("platform_alert_recipients")) return [{ email: "admin@example.test" }];
      throw new Error("unexpected query");
    }),
  } as unknown as Database;
  return { db, snaps, changes };
}

const res = (body: string, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(init.status === 304 ? null : body, { status: init.status ?? 200, headers: { "content-type": "text/markdown", ...(init.headers ?? {}) } });

const sources = [{ key: "ai_providers", label: "AI", url: "https://developers.facebook.com/x.md" }];

describe("runPolicyMonitor", () => {
  it("stores a first snapshot without creating a change or e-mail", async () => {
    const { db, snaps } = fakeDb();
    const mailer = { send: vi.fn(async () => undefined) };
    const fetch = vi.fn<PolicyFetch>(async () => res("# AI\n\nTexto", { headers: { etag: '"v1"' } }));
    const r = await runPolicyMonitor({ db, fetch, mailer, sources });
    expect(r.outcomes["ai_providers"]).toBe("first_snapshot");
    expect(snaps["ai_providers"]?.etag).toBe('"v1"');
    expect(mailer.send).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0]?.[1].headers["user-agent"]).toBe(POLICY_USER_AGENT);
  });

  it("detects a change, records the diff and e-mails admins; unchanged text does nothing", async () => {
    const old = "# AI\nTexto";
    const { db, changes } = fakeDb({ ai_providers: { content_hash: policyTextHash(old), content: old, etag: '"v1"' } });
    const mailer = { send: vi.fn(async () => undefined) };
    const same = await runPolicyMonitor({ db, fetch: async () => res("# AI\n\nTexto  "), mailer, sources });
    expect(same.outcomes["ai_providers"]).toBe("unchanged");
    const r = await runPolicyMonitor({ db, fetch: async () => res("# AI\nTexto\nNueva regla"), mailer, sources });
    expect(r).toEqual({ outcomes: { ai_providers: "changed" }, changes: 1 });
    expect(changes).toEqual(["ai_providers"]);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mailer.send.mock.calls[0])).toContain("+ Nueva regla");
  });

  it("sends If-None-Match and honours 304", async () => {
    const { db } = fakeDb({ ai_providers: { content_hash: policyTextHash("x"), content: "x", etag: '"v9"' } });
    const fetch = vi.fn<PolicyFetch>(async () => res("", { status: 304 }));
    const r = await runPolicyMonitor({ db, fetch, sources });
    expect(r.outcomes["ai_providers"]).toBe("not_modified");
    expect(fetch.mock.calls[0]?.[1].headers["if-none-match"]).toBe('"v9"');
  });

  it("retries 5xx, gives up on 4xx and keeps going with the other sources", async () => {
    const { db } = fakeDb();
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const fetch: PolicyFetch = async (url) => {
      calls++;
      if (url.includes("a.md")) return res("", { status: 503 });
      if (url.includes("b.md")) return res("", { status: 404 });
      return res("ok");
    };
    const r = await runPolicyMonitor({
      db,
      fetch,
      sleep,
      retries: 2,
      sources: [
        { key: "a_src", label: "A", url: "https://developers.facebook.com/a.md" },
        { key: "b_src", label: "B", url: "https://developers.facebook.com/b.md" },
        { key: "c_src", label: "C", url: "https://developers.facebook.com/c.md" },
      ],
    });
    expect(r.outcomes).toEqual({ a_src: "failed", b_src: "failed", c_src: "first_snapshot" });
    expect(calls).toBe(3 + 1 + 1);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("refuses oversized bodies", async () => {
    const { db } = fakeDb();
    const r = await runPolicyMonitor({ db, fetch: async () => res("x", { headers: { "content-length": String(10 * 1024 * 1024) } }), retries: 0, sources });
    expect(r.outcomes["ai_providers"]).toBe("failed");
  });
});
