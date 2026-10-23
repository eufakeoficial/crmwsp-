import type { CipherBox } from "@crmwsp/crypto";
import type { Database } from "@crmwsp/db";
import type { ProviderTemplate, WhatsAppConnection } from "@crmwsp/whatsapp";
import { describe, expect, it, vi } from "vitest";
import {
  planTemplateSync,
  runTemplateSyncTick,
  syncTemplatesTenant,
  type LocalTemplate,
  type SyncChannel,
  type TemplateSyncDeps,
  type TemplateSyncStore,
} from "../templates/sync.js";

const SECRET = "sk_live_TEMPLATE_SYNC_SECRET";
const now = new Date("2026-10-20T12:00:00Z");

const remote = (o: Partial<ProviderTemplate> & { name: string }): ProviderTemplate => ({
  externalId: `ext-${o.name}`,
  language: "es",
  category: "marketing",
  status: "approved",
  body: "Hola {{1}}",
  ...o,
});
const local = (o: Partial<LocalTemplate> & { id: string; name: string }): LocalTemplate => ({
  language: "es",
  status: "pending",
  externalId: null,
  ...o,
});

describe("planTemplateSync", () => {
  it("updates changed status/externalId, ignores unchanged, imports unknown, leaves local-only alone", () => {
    const plan = planTemplateSync(
      [
        local({ id: "1", name: "a" }),
        local({ id: "2", name: "b", status: "approved", externalId: "ext-b" }),
        local({ id: "3", name: "only_local" }),
        local({ id: "4", name: "a", language: "en" }),
      ],
      [remote({ name: "a", status: "rejected" }), remote({ name: "b" }), remote({ name: "console_made" })],
    );
    expect(plan.updates).toEqual([{ id: "1", status: "rejected", externalId: "ext-a" }]);
    expect(plan.inserts.map((t) => t.name)).toEqual(["console_made"]);
  });

  it("matches on language too", () => {
    const plan = planTemplateSync([local({ id: "1", name: "a", language: "en" })], [remote({ name: "a", language: "es" })]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
  });
});

function fakeStore(channels: SyncChannel[], templates: Map<string, LocalTemplate[]>) {
  const applied: Array<{ channelId: string; updates: number; inserts: number; now: Date }> = [];
  const store: TemplateSyncStore = {
    loadChannels: async () => channels,
    loadTemplates: async (id) => templates.get(id) ?? [],
    apply: async (channelId, plan, at) => {
      applied.push({ channelId, updates: plan.updates.length, inserts: plan.inserts.length, now: at });
    },
  };
  return { store, applied };
}

const ch = (id: string): SyncChannel => ({ id, appName: `app-${id}`, sourcePhone: "+5491140000000", credentials: Buffer.from("enc"), partnerAppId: `pa-${id}`, partnerToken: Buffer.from("ptok") });
const PARTNER = "partner_TOKEN_secret";
const cipher = { decrypt: vi.fn((_b: Buffer, ctx: { purpose: string }) => (ctx.purpose === "gupshup_partner_token" ? PARTNER : SECRET)) } as unknown as CipherBox;

function deps(over: Partial<TemplateSyncDeps> & Pick<TemplateSyncDeps, "provider" | "inTenant">): TemplateSyncDeps {
  return { db: {} as Database, cipher, now: () => now, ...over };
}

describe("syncTemplatesTenant", () => {
  it("lists per channel with the decrypted key and applies the plan", async () => {
    const { store, applied } = fakeStore([ch("c1")], new Map([["c1", [local({ id: "1", name: "a" })]]]));
    const listTemplates = vi.fn(async (_c: WhatsAppConnection) => [remote({ name: "a" })]);
    const res = await syncTemplatesTenant(
      deps({ provider: { listTemplates }, inTenant: (_t, fn) => fn(store) }),
      "tenant-1",
    );
    expect(res).toEqual({ channels: 1, updated: 1, imported: 0, failedChannels: 0, skippedChannels: 0 });
    expect(listTemplates).toHaveBeenCalledWith({ apiKey: SECRET, appName: "app-c1", sourcePhone: "+5491140000000", partnerAppId: "pa-c1", partnerToken: PARTNER });
    expect(cipher.decrypt).toHaveBeenCalledWith(expect.any(Buffer), { tenantId: "tenant-1", purpose: "gupshup_api_key" });
    expect(applied).toEqual([{ channelId: "c1", updates: 1, inserts: 0, now }]);
  });

  it("a failing channel does not stop the next and never logs the key", async () => {
    const { store, applied } = fakeStore([ch("c1"), ch("c2")], new Map());
    const warn = vi.fn();
    const listTemplates = vi
      .fn<(c: WhatsAppConnection) => Promise<ProviderTemplate[]>>()
      .mockRejectedValueOnce(new Error(`boom ${SECRET} ${PARTNER}`))
      .mockResolvedValueOnce([remote({ name: "x" })]);
    const res = await syncTemplatesTenant(
      deps({ provider: { listTemplates }, inTenant: (_t, fn) => fn(store), logger: { info: vi.fn(), warn, error: vi.fn() } }),
      "tenant-1",
    );
    expect(res).toMatchObject({ channels: 2, imported: 1, failedChannels: 1 });
    expect(applied.map((a) => a.channelId)).toEqual(["c2"]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PARTNER);
  });
});

describe("channels without partner credentials", () => {
  it("are skipped with a reason, not failed, and the BSP is never called for them", async () => {
    const noCreds: SyncChannel[] = [
      { ...ch("c1"), partnerAppId: null },
      { ...ch("c2"), partnerToken: null },
      ch("c3"),
    ];
    const { store, applied } = fakeStore(noCreds, new Map());
    const info = vi.fn();
    const listTemplates = vi.fn(async (_c: WhatsAppConnection) => [] as ProviderTemplate[]);
    const res = await syncTemplatesTenant(
      deps({ provider: { listTemplates }, inTenant: (_t, fn) => fn(store), logger: { info, warn: vi.fn(), error: vi.fn() } }),
      "tenant-1",
    );
    expect(res).toEqual({ channels: 3, updated: 0, imported: 0, failedChannels: 0, skippedChannels: 2 });
    expect(listTemplates).toHaveBeenCalledTimes(1);
    expect(applied.map((a) => a.channelId)).toEqual(["c3"]);
    expect(info).toHaveBeenCalledTimes(2);
    expect(String(info.mock.calls[0]![0])).toContain("no Gupshup partner credentials");
  });
});

describe("runTemplateSyncTick", () => {
  it("isolates tenant failures", async () => {
    const { store } = fakeStore([ch("c1")], new Map());
    const warn = vi.fn();
    const res = await runTemplateSyncTick(
      deps({
        provider: { listTemplates: async () => [remote({ name: "x" })] },
        listTenants: async () => ["t-bad", "t-ok"],
        inTenant: async (tenantId, fn) => {
          if (tenantId === "t-bad") throw new Error("db down");
          return fn(store);
        },
        logger: { info: vi.fn(), warn, error: vi.fn() },
      }),
    );
    expect(res).toEqual({ tenants: 2, updated: 0, imported: 1, failedChannels: 0, skippedChannels: 0, failedTenants: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
