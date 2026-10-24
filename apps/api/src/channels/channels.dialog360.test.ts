import type { CipherBox } from "@crmwsp/crypto";
import type { Transaction } from "@crmwsp/db";
import { EncryptionNotConfiguredError, PlanLimitExceededError, ValidationError } from "@crmwsp/contracts";
import type { Dialog360PartnerClient, WhatsAppProvider } from "@crmwsp/whatsapp";
import { describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { ChannelsController } from "./channels.controller.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const API_KEY = "d360_CHANNEL_KEY_SECRET_999";

/** Queue-driven fake transaction (same approach as channels.templates.test.ts). */
function fakeDb(selects: unknown[][]) {
  const queue = [...selects];
  const inserts: Array<Record<string, unknown>> = [];
  const tx = {
    select: () => {
      const chain: Record<string, unknown> = {};
      const result = queue.shift() ?? [];
      for (const k of ["from", "where"]) chain[k] = () => chain;
      chain["then"] = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      return chain;
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        const p = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<unknown[]> };
        p.returning = async () => [
          { id: `00000000-0000-4000-8000-00000000d${inserts.length}`, createdAt: new Date("2026-10-20T00:00:00Z"), updatedAt: new Date("2026-10-20T00:00:00Z"), ...v },
        ];
        return p;
      },
    }),
  };
  const db = { tenantId: TENANT, userId: "user-1", run: <T>(fn: (t: Transaction) => Promise<T>) => fn(tx as unknown as Transaction) } as unknown as TenantDb;
  return { db, inserts };
}

/** Plan limit stub: allows up to `free` more numbers. */
function limitsStub(free = 10) {
  return {
    lock: vi.fn(async () => undefined),
    startTrialIfEligible: vi.fn(async () => "started" as const),
    assert: vi.fn(async (_t: string, key: string, amount = 1) => {
      if (amount > free) throw new PlanLimitExceededError(`Plan Start: ${key} limit_reached`, { details: { key, reason: "limit_reached" } });
    }),
  };
}

function make(partner: Partial<Dialog360PartnerClient> | null, cipher: CipherBox | null = null, limits = limitsStub()) {
  const c =
    cipher ??
    ({ encrypt: vi.fn(() => Buffer.from("cipher")), decrypt: vi.fn(() => API_KEY) } as unknown as CipherBox);
  return { controller: new ChannelsController(c, {} as WhatsAppProvider, partner as Dialog360PartnerClient | null, limits), cipher: c, limits };
}

const req = { ip: "127.0.0.1" } as unknown as HttpRequest;
const partnerStub = (over: Record<string, unknown> = {}) => ({
  findChannelPhone: vi.fn(async () => "+5491140000000"),
  createChannelApiKey: vi.fn(async () => API_KEY),
  setWebhook: vi.fn(async () => undefined),
  ...over,
});

describe("POST /channels/360dialog/connect", () => {
  it("creates the key, registers the tokenized webhook and stores the channel encrypted", async () => {
    const partner = partnerStub();
    const { controller, cipher } = make(partner as unknown as Dialog360PartnerClient);
    const { db, inserts } = fakeDb([[]]);
    const out = await controller.connect360dialog(db, { clientId: "cl1", channelIds: ["CH1"] }, req);

    expect(partner.createChannelApiKey).toHaveBeenCalledWith("CH1");
    const hook = partner.setWebhook.mock.calls[0] as unknown as [string, string];
    expect(hook[0]).toBe(API_KEY);
    expect(hook[1]).toMatch(/\/webhooks\/360dialog\/[A-Za-z0-9_-]{43}$/);
    expect(cipher.encrypt).toHaveBeenCalledWith(API_KEY, { tenantId: TENANT, purpose: "gupshup_api_key" });

    const row = inserts[0]!;
    expect(row).toMatchObject({ tenantId: TENANT, provider: "360dialog", phoneE164: "+5491140000000", externalAppId: "CH1", status: "active" });
    expect(row["credentialsEncrypted"]).toEqual(Buffer.from("cipher"));
    // The webhook registered at 360dialog carries the same token that is stored.
    expect(hook[1].endsWith(`/${String(row["webhookToken"])}`)).toBe(true);

    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ provider: "360dialog", appName: "CH1" });
    expect(out.items[0]!.webhookUrl).toContain("/webhooks/360dialog/");
    expect(JSON.stringify(out)).not.toContain(API_KEY);
  });

  it("is idempotent: an already connected channel is returned without regenerating its key", async () => {
    const partner = partnerStub();
    const { controller } = make(partner as unknown as Dialog360PartnerClient);
    const existing = {
      id: "00000000-0000-4000-8000-0000000000e1",
      tenantId: TENANT,
      provider: "360dialog",
      phoneE164: "+5491140000000",
      externalAppId: "CH1",
      credentialsEncrypted: Buffer.from("enc"),
      gupshupAppId: null,
      partnerTokenEncrypted: null,
      webhookToken: "t".repeat(43),
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db, inserts } = fakeDb([[existing]]);
    const out = await controller.connect360dialog(db, { channelIds: ["CH1"] }, req);
    expect(out.items).toHaveLength(1);
    expect(partner.createChannelApiKey).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("asks for the phone when the Hub does not expose it, and uses it when given", async () => {
    const partner = partnerStub({ findChannelPhone: vi.fn(async () => undefined) });
    const { controller } = make(partner as unknown as Dialog360PartnerClient);
    await expect(controller.connect360dialog(fakeDb([[]]).db, { channelIds: ["CH1"] }, req)).rejects.toBeInstanceOf(ValidationError);
    expect(partner.createChannelApiKey).not.toHaveBeenCalled();

    const { db, inserts } = fakeDb([[]]);
    await controller.connect360dialog(db, { channelIds: ["CH1"], phoneE164: "+5491166667777" }, req);
    expect(inserts[0]).toMatchObject({ phoneE164: "+5491166667777" });
  });

  it("refuses with 402 before minting any API key when the plan has no free number", async () => {
    const partner = partnerStub();
    const { controller } = make(partner as unknown as Dialog360PartnerClient, null, limitsStub(0));
    const { db, inserts } = fakeDb([[]]);
    await expect(controller.connect360dialog(db, { channelIds: ["CH1"] }, req)).rejects.toBeInstanceOf(PlanLimitExceededError);
    expect(partner.createChannelApiKey).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("checks the number limit again inside the insert transaction, under the per-tenant lock", async () => {
    const partner = partnerStub();
    const { controller, limits } = make(partner as unknown as Dialog360PartnerClient);
    await controller.connect360dialog(fakeDb([[]]).db, { channelIds: ["CH1"] }, req);
    expect(limits.lock).toHaveBeenCalledWith(expect.anything(), TENANT, "whatsapp_numbers");
    expect(limits.assert).toHaveBeenLastCalledWith(TENANT, "whatsapp_numbers", 1, expect.anything());
    // The first active channel starts the trial of a tenant in setup (ADR 0015).
    expect(limits.startTrialIfEligible).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed channel ids and unconfigured partner credentials", async () => {
    const { controller } = make(partnerStub() as unknown as Dialog360PartnerClient);
    await expect(controller.connect360dialog(fakeDb([]).db, { channelIds: ["../x"] }, req)).rejects.toBeInstanceOf(ValidationError);
    const off = make(null);
    await expect(off.controller.connect360dialog(fakeDb([]).db, { channelIds: ["CH1"] }, req)).rejects.toBeInstanceOf(EncryptionNotConfiguredError);
  });
});

describe("POST /channels/gupshup plan limit", () => {
  it("refuses with 402 and inserts nothing when the plan has no free number", async () => {
    const { controller } = make(null, null, limitsStub(0));
    const { db, inserts } = fakeDb([]);
    const body = { phoneE164: "+5491140000001", appName: "app1", apiKey: "gs_secret_key_123456" };
    await expect(controller.createGupshup(db, body, req)).rejects.toBeInstanceOf(PlanLimitExceededError);
    expect(inserts).toHaveLength(0);
  });
});
