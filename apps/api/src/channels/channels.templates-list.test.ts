import type { CipherBox } from "@crmwsp/crypto";
import type { Transaction } from "@crmwsp/db";
import { NotFoundError, ValidationError } from "@crmwsp/contracts";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import { describe, expect, it, vi } from "vitest";
import type { TenantDb } from "../db/tenant-db.js";
import { ChannelsController } from "./channels.controller.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const CHANNEL = "00000000-0000-4000-8000-0000000000c1";
const D = new Date("2026-10-20T00:00:00Z");

const tplRow = (o: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-0000000000d1", tenantId: TENANT, channelConnectionId: CHANNEL, name: "promo", language: "es",
  category: "marketing", status: "pending", body: "Hola", variables: [], externalId: "e1", syncedAt: null, createdAt: D, updatedAt: D, ...o,
});
const channelRow = (o: Record<string, unknown> = {}) => ({
  id: CHANNEL, provider: "gupshup", status: "active", phoneE164: "+5491140000000", appName: "App",
  credentials: Buffer.from("enc"), partnerAppId: "app-1", partnerToken: Buffer.from("p"), ...o,
});

/** Queue-driven tx: each select resolves to the next queued result (orderBy is a passthrough). */
function fakeDb(selects: unknown[][]) {
  const queue = [...selects];
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  const tx = {
    select: () => {
      const result = queue.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const k of ["from", "where", "orderBy"]) chain[k] = () => chain;
      chain["then"] = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      return chain;
    },
    update: () => ({ set: (v: unknown) => { updates.push(v); return { where: async () => undefined }; } }),
    insert: () => ({ values: (v: unknown) => { inserts.push(v); return { onConflictDoNothing: async () => undefined }; } }),
  };
  return { updates, inserts, db: { tenantId: TENANT, userId: "u", run: <T>(fn: (t: Transaction) => Promise<T>) => fn(tx as unknown as Transaction) } as unknown as TenantDb };
}

function make(listTemplates = vi.fn(async () => [] as unknown[]), cipher: CipherBox | null = { decrypt: vi.fn(() => "secret") } as unknown as CipherBox) {
  const provider = { listTemplates } as unknown as WhatsAppProvider;
  return { controller: new ChannelsController(cipher, provider, null, { assert: vi.fn(), lock: vi.fn(), startTrialIfEligible: vi.fn() } as never), listTemplates };
}

describe("GET /channels/:id/templates", () => {
  it("lists the channel templates as DTOs", async () => {
    const { controller } = make();
    const out = await controller.listTemplates(fakeDb([[{ id: CHANNEL }], [tplRow({ status: "rejected" })]]).db, CHANNEL);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ name: "promo", status: "rejected", syncedAt: null, createdAt: D.toISOString() });
  });

  it("404 for a malformed id or unknown channel", async () => {
    const { controller } = make();
    await expect(controller.listTemplates(fakeDb([]).db, "nope")).rejects.toBeInstanceOf(NotFoundError);
    await expect(controller.listTemplates(fakeDb([[]]).db, CHANNEL)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("POST /channels/:id/templates/sync", () => {
  it("applies the BSP listing and returns counts, reasons and the fresh list", async () => {
    const remote = [
      { externalId: "e1", name: "promo", language: "es", category: "marketing", status: "rejected", body: "Hola", reason: "INVALID_FORMAT" },
      { externalId: "e2", name: "nueva", language: "es", category: "utility", status: "approved", body: "Chau" },
    ];
    const { controller, listTemplates } = make(vi.fn(async () => remote));
    const { db, updates, inserts } = fakeDb([[channelRow()], [tplRow()], [tplRow({ status: "rejected" })]]);
    const out = await controller.syncTemplates(db, CHANNEL);
    expect(listTemplates).toHaveBeenCalledWith(expect.objectContaining({ provider: "gupshup", partnerAppId: "app-1", partnerToken: "secret" }));
    expect(updates).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(out).toMatchObject({ updated: 1, imported: 1, rejections: [{ name: "promo", reason: "INVALID_FORMAT" }] });
    expect(out.items).toHaveLength(1);
  });

  it("400 without partner credentials and never calls the BSP", async () => {
    const { controller, listTemplates } = make();
    await expect(controller.syncTemplates(fakeDb([[channelRow({ partnerToken: null })]]).db, CHANNEL)).rejects.toBeInstanceOf(ValidationError);
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it("404 for an unknown channel; 503-style when encryption is off", async () => {
    await expect(make().controller.syncTemplates(fakeDb([[]]).db, CHANNEL)).rejects.toBeInstanceOf(NotFoundError);
    await expect(make(undefined, null).controller.syncTemplates(fakeDb([]).db, CHANNEL)).rejects.toMatchObject({ name: "EncryptionNotConfiguredError" });
  });
});
