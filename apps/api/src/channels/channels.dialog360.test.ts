import type { CipherBox } from "@crmwsp/crypto";
import type { Transaction } from "@crmwsp/db";
import { ConflictError, EncryptionNotConfiguredError, ForbiddenError, PlanLimitExceededError, ValidationError } from "@crmwsp/contracts";
import type { Dialog360PartnerClient, WhatsAppProvider } from "@crmwsp/whatsapp";
import { describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { ChannelsController, hashConnectState } from "./channels.controller.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const API_KEY = "d360_CHANNEL_KEY_SECRET_999";

/** Queue-driven fake transaction (same approach as channels.templates.test.ts). */
interface DbOpts {
  /** channel ids the ownership probe reports as connected by another tenant. */
  ownedElsewhere?: string[];
  /** state hashes (hex) that check/consume accept; consumed ones are removed. */
  states?: Set<string>;
}

const STATE = "s".repeat(43);
const stateHex = () => hashConnectState(STATE).toString("hex");

/** Flattens a drizzle sql chunk enough to tell which function is called and grab its params. */
function sqlInfo(q: unknown): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  let text = "";
  const walk = (c: unknown): void => {
    if (c && typeof c === "object" && "queryChunks" in c) {
      for (const x of (c as { queryChunks: unknown[] }).queryChunks) walk(x);
    } else if (c && typeof c === "object" && "value" in c && Array.isArray((c as { value: unknown }).value)) {
      text += (c as { value: string[] }).value.join("");
    } else {
      params.push(c);
      text += "?";
    }
  };
  walk(q);
  return { text, params };
}

function fakeDb(selects: unknown[][], opts: DbOpts = {}) {
  const queue = [...selects];
  const inserts: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const states = opts.states ?? new Set([stateHex()]);
  const tx = {
    execute: async (q: unknown) => {
      const { text, params } = sqlInfo(q);
      const hashHex = () => (params.find((p) => Buffer.isBuffer(p)) as Buffer | undefined)?.toString("hex") ?? "";
      if (text.includes("channel_connect_state_check")) return [{ ok: states.has(hashHex()) }];
      if (text.includes("channel_connect_state_consume")) return [{ ok: states.delete(hashHex()) }];
      if (text.includes("channel_external_owned_elsewhere")) {
        return (opts.ownedElsewhere ?? []).filter((id) => params.includes(id)).map((id) => ({ id }));
      }
      return [];
    },
    select: () => {
      const chain: Record<string, unknown> = {};
      const result = queue.shift() ?? [];
      for (const k of ["from", "where"]) chain[k] = () => chain;
      chain["then"] = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      return chain;
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (typeof v["action"] === "string") {
          audits.push(v);
          return Promise.resolve(undefined);
        }
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
  return { db, inserts, audits };
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
const BODY = { clientId: "cl1", channelIds: ["CH1"], state: STATE };
const partnerStub = (over: Record<string, unknown> = {}) => ({
  getChannel: vi.fn(async (id: string) => ({ id, clientId: "cl1", phone: "+5491140000000" })),
  createChannelApiKey: vi.fn(async () => API_KEY),
  setWebhook: vi.fn(async () => undefined),
  ...over,
});

describe("POST /channels/360dialog/connect", () => {
  it("creates the key, registers the tokenized webhook and stores the channel encrypted", async () => {
    const partner = partnerStub();
    const { controller, cipher } = make(partner as unknown as Dialog360PartnerClient);
    const { db, inserts } = fakeDb([[]]);
    const out = await controller.connect360dialog(db, BODY, req);

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
    const out = await controller.connect360dialog(db, BODY, req);
    expect(out.items).toHaveLength(1);
    expect(partner.createChannelApiKey).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("asks for the phone when the Hub does not expose it, and uses it when given", async () => {
    const partner = partnerStub({ getChannel: vi.fn(async (id: string) => ({ id, clientId: "cl1" })) });
    const { controller } = make(partner as unknown as Dialog360PartnerClient);
    await expect(controller.connect360dialog(fakeDb([[]]).db, BODY, req)).rejects.toBeInstanceOf(ValidationError);
    expect(partner.createChannelApiKey).not.toHaveBeenCalled();

    const { db, inserts } = fakeDb([[]]);
    await controller.connect360dialog(db, { ...BODY, phoneE164: "+5491166667777" }, req);
    expect(inserts[0]).toMatchObject({ phoneE164: "+5491166667777" });
  });

  it("refuses with 402 before minting any API key when the plan has no free number", async () => {
    const partner = partnerStub();
    const { controller } = make(partner as unknown as Dialog360PartnerClient, null, limitsStub(0));
    const { db, inserts } = fakeDb([[]]);
    await expect(controller.connect360dialog(db, BODY, req)).rejects.toBeInstanceOf(PlanLimitExceededError);
    expect(partner.createChannelApiKey).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("checks the number limit again inside the insert transaction, under the per-tenant lock", async () => {
    const partner = partnerStub();
    const { controller, limits } = make(partner as unknown as Dialog360PartnerClient);
    await controller.connect360dialog(fakeDb([[]]).db, BODY, req);
    expect(limits.lock).toHaveBeenCalledWith(expect.anything(), TENANT, "whatsapp_numbers");
    expect(limits.assert).toHaveBeenLastCalledWith(TENANT, "whatsapp_numbers", 1, expect.anything());
    // The first active channel starts the trial of a tenant in setup (ADR 0015).
    expect(limits.startTrialIfEligible).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed channel ids and unconfigured partner credentials", async () => {
    const { controller } = make(partnerStub() as unknown as Dialog360PartnerClient);
    await expect(controller.connect360dialog(fakeDb([]).db, { ...BODY, channelIds: ["../x"] }, req)).rejects.toBeInstanceOf(ValidationError);
    const off = make(null);
    await expect(off.controller.connect360dialog(fakeDb([]).db, BODY, req)).rejects.toBeInstanceOf(EncryptionNotConfiguredError);
  });
});

describe("POST /channels/360dialog/connect hardening (F1)", () => {
  it("refuses a channel id owned by another tenant with 409, audited, with no Partner call", async () => {
    const partner = partnerStub();
    const { controller } = make(partner as unknown as Dialog360PartnerClient);
    const { db, audits, inserts } = fakeDb([[]], { ownedElsewhere: ["CH1"] });
    await expect(controller.connect360dialog(db, BODY, req)).rejects.toBeInstanceOf(ConflictError);
    expect(partner.getChannel).not.toHaveBeenCalled();
    expect(partner.createChannelApiKey).not.toHaveBeenCalled();
    expect(partner.setWebhook).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(audits[0]).toMatchObject({ action: "channel.connect_refused", diff: expect.objectContaining({ reason: "owned_by_another_tenant" }) });
  });

  it("requires clientId and refuses channels that do not belong to it", async () => {
    const partner = partnerStub({ getChannel: vi.fn(async (id: string) => ({ id, clientId: "someone_else" })) });
    const { controller } = make(partner as unknown as Dialog360PartnerClient);
    const { clientId: _omit, ...noClient } = BODY;
    await expect(controller.connect360dialog(fakeDb([[]]).db, noClient, req)).rejects.toBeInstanceOf(ValidationError);
    const { db, audits } = fakeDb([[]]);
    await expect(controller.connect360dialog(db, BODY, req)).rejects.toBeInstanceOf(ForbiddenError);
    expect(partner.createChannelApiKey).not.toHaveBeenCalled();
    expect(audits[0]).toMatchObject({ action: "channel.connect_refused", diff: expect.objectContaining({ reason: "client_mismatch" }) });
    const unknown = partnerStub({ getChannel: vi.fn(async () => undefined) });
    const u = make(unknown as unknown as Dialog360PartnerClient);
    await expect(u.controller.connect360dialog(fakeDb([[]]).db, BODY, req)).rejects.toBeInstanceOf(ForbiddenError);
    expect(unknown.createChannelApiKey).not.toHaveBeenCalled();
  });

  it("refuses a missing, invalid or reused state before minting any key", async () => {
    const partner = partnerStub();
    const { controller } = make(partner as unknown as Dialog360PartnerClient);
    const { state: _s, ...noState } = BODY;
    await expect(controller.connect360dialog(fakeDb([[]]).db, noState, req)).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.connect360dialog(fakeDb([[]]).db, { ...BODY, state: "x".repeat(43) }, req)).rejects.toBeInstanceOf(ForbiddenError);
    expect(partner.getChannel).not.toHaveBeenCalled();

    const states = new Set([stateHex()]);
    await controller.connect360dialog(fakeDb([[]], { states }).db, BODY, req);
    expect(partner.createChannelApiKey).toHaveBeenCalledTimes(1);
    // Replay of the same redirect: the state was consumed.
    await expect(controller.connect360dialog(fakeDb([[]], { states }).db, BODY, req)).rejects.toBeInstanceOf(ForbiddenError);
    expect(partner.createChannelApiKey).toHaveBeenCalledTimes(1);
  });

  it("keeps the state when it only needs the phone, so the retry works", async () => {
    const partner = partnerStub({ getChannel: vi.fn(async (id: string) => ({ id, clientId: "cl1" })) });
    const { controller } = make(partner as unknown as Dialog360PartnerClient);
    const states = new Set([stateHex()]);
    await expect(controller.connect360dialog(fakeDb([[]], { states }).db, BODY, req)).rejects.toBeInstanceOf(ValidationError);
    expect(states.size).toBe(1);
    await controller.connect360dialog(fakeDb([[]], { states }).db, { ...BODY, phoneE164: "+5491166667777" }, req);
    expect(states.size).toBe(0);
  });

  it("issues a state and stores only its hash", async () => {
    const { controller } = make(partnerStub() as unknown as Dialog360PartnerClient);
    let stored: unknown[] = [];
    const db = {
      tenantId: TENANT,
      userId: "user-1",
      run: <T>(fn: (t: Transaction) => Promise<T>) =>
        fn({
          execute: async (q: unknown) => {
            stored = sqlInfo(q).params;
            return [{ e: "2026-10-24 12:15:00+00" }];
          },
        } as unknown as Transaction),
    } as unknown as TenantDb;
    const out = await controller.dialog360ConnectState(db);
    expect(out.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored).not.toContain(out.state);
    expect(stored.some((p) => Buffer.isBuffer(p) && p.equals(hashConnectState(out.state)))).toBe(true);
    expect(out.expiresAt).toBe("2026-10-24T12:15:00.000Z");
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
