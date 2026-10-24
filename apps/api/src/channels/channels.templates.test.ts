import type { CipherBox } from "@crmwsp/crypto";
import type { Transaction } from "@crmwsp/db";
import { ConflictError, ExternalProviderError, NotFoundError, ValidationError } from "@crmwsp/contracts";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import { describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { ChannelsController } from "./channels.controller.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const CHANNEL = "00000000-0000-4000-8000-0000000000c1";
const SECRET = "sk_live_API_TEMPLATE_SECRET";
const PARTNER = "partner_TOKEN_secret_xyz";

/**
 * Queue-driven fake transaction: each `select()` chain resolves to the next queued result; `insert()` chains
 * resolve `returning()` to the next queued row. Audit inserts (no `returning`) are recorded.
 */
function fakeDb(selects: unknown[][], inserted: Record<string, unknown>[] = []) {
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
          { id: "00000000-0000-4000-8000-0000000000d1", createdAt: new Date("2026-10-20T00:00:00Z"), updatedAt: new Date("2026-10-20T00:00:00Z"), ...v, ...(inserted[0] ?? {}) },
        ];
        return p;
      },
    }),
  };
  const db = { tenantId: TENANT, userId: "user-1", run: <T>(fn: (t: Transaction) => Promise<T>) => fn(tx as unknown as Transaction) } as unknown as TenantDb;
  return { db, inserts };
}

const channelRow = (o: Record<string, unknown> = {}) => ({
  provider: "gupshup",
  status: "active",
  phoneE164: "+5491140000000",
  appName: "DemoApp",
  credentials: Buffer.from("enc"),
  partnerAppId: "app-uuid-1",
  partnerToken: Buffer.from("penc"),
  ...o,
});

function make(provider?: Partial<WhatsAppProvider>, cipher: CipherBox | null = { decrypt: vi.fn((_b: Buffer, ctx: { purpose: string }) => (ctx.purpose === "gupshup_partner_token" ? PARTNER : SECRET)), encrypt: vi.fn(() => Buffer.from("cipher")) } as unknown as CipherBox) {
  const submitTemplate = vi.fn(async () => ({ externalId: "tpl-9", status: "pending" as const }));
  const p = { submitTemplate, ...provider } as unknown as WhatsAppProvider;
  return { controller: new ChannelsController(cipher, p, null, { assert: vi.fn(async () => undefined), lock: vi.fn(async () => undefined) }), submitTemplate, cipher };
}

const req = { ip: "127.0.0.1" } as unknown as HttpRequest;
const body = { name: "promo_otono", language: "es", category: "marketing", body: "Hola {{1}}", example: "Hola Ana" };

describe("POST /channels/:id/templates", () => {
  it("submits for a 360dialog channel without partner credentials", async () => {
    const { db } = fakeDb([[channelRow({ provider: "360dialog", partnerAppId: null, partnerToken: null })], []]);
    const { controller, submitTemplate } = make();
    await controller.submitTemplate(db, CHANNEL, body, req);
    expect(submitTemplate).toHaveBeenCalledWith(
      { provider: "360dialog", apiKey: SECRET, appName: "DemoApp", sourcePhone: "+5491140000000" },
      expect.objectContaining({ name: "promo_otono" }),
    );
  });

  it("submits to the BSP with the decrypted key and stores the answered status", async () => {
    const { db, inserts } = fakeDb([[channelRow()], []]);
    const { controller, submitTemplate, cipher } = make();
    const out = await controller.submitTemplate(db, CHANNEL, body, req);
    expect(submitTemplate).toHaveBeenCalledWith(
      { provider: "gupshup", apiKey: SECRET, appName: "DemoApp", sourcePhone: "+5491140000000", partnerAppId: "app-uuid-1", partnerToken: PARTNER },
      { name: "promo_otono", language: "es", category: "marketing", body: "Hola {{1}}", example: "Hola Ana" },
    );
    expect(cipher?.decrypt).toHaveBeenCalledWith(expect.any(Buffer), { tenantId: TENANT, purpose: "gupshup_api_key" });
    expect(out).toMatchObject({ name: "promo_otono", status: "pending", externalId: "tpl-9", channelConnectionId: CHANNEL, category: "marketing" });
    expect(inserts[0]).toMatchObject({ tenantId: TENANT, channelConnectionId: CHANNEL, status: "pending", externalId: "tpl-9" });
    expect(inserts[1]).toMatchObject({ tenantId: TENANT, action: "template.submitted", entity: "message_template" });
    expect(JSON.stringify(out) + JSON.stringify(inserts)).not.toContain(SECRET);
    expect(JSON.stringify(out) + JSON.stringify(inserts)).not.toContain(PARTNER);
  });

  it("404 for a malformed id or unknown channel", async () => {
    const { controller } = make();
    await expect(controller.submitTemplate(fakeDb([]).db, "nope", body, req)).rejects.toBeInstanceOf(NotFoundError);
    await expect(controller.submitTemplate(fakeDb([[]]).db, CHANNEL, body, req)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("409 on a duplicate name+language without calling the BSP", async () => {
    const { controller, submitTemplate } = make();
    await expect(controller.submitTemplate(fakeDb([[channelRow()], [{ id: "x" }]]).db, CHANNEL, body, req)).rejects.toBeInstanceOf(ConflictError);
    expect(submitTemplate).not.toHaveBeenCalled();
  });

  it("rejects invalid input, disabled channels and non-gupshup providers before calling the BSP", async () => {
    const { controller, submitTemplate } = make();
    await expect(controller.submitTemplate(fakeDb([]).db, CHANNEL, { ...body, name: "Bad Name" }, req)).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.submitTemplate(fakeDb([]).db, CHANNEL, { ...body, example: undefined }, req)).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.submitTemplate(fakeDb([[channelRow({ status: "disabled" })], []]).db, CHANNEL, body, req)).rejects.toBeInstanceOf(ValidationError);
    expect(submitTemplate).not.toHaveBeenCalled();
  });

  it("400 with a clear reason when the channel has no partner credentials, without calling the BSP", async () => {
    const { controller, submitTemplate } = make();
    for (const o of [{ partnerAppId: null }, { partnerToken: null }]) {
      const e = await controller.submitTemplate(fakeDb([[channelRow(o)], []]).db, CHANNEL, body, req).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as Error).message).toContain("partner credentials");
    }
    expect(submitTemplate).not.toHaveBeenCalled();
  });

  it("400 with a clear reason when the channel has no partner credentials, without calling the BSP", async () => {
    const { controller, submitTemplate } = make();
    for (const o of [{ partnerAppId: null }, { partnerToken: null }]) {
      const e = await controller.submitTemplate(fakeDb([[channelRow(o)], []]).db, CHANNEL, body, req).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as Error).message).toContain("partner credentials");
    }
    expect(submitTemplate).not.toHaveBeenCalled();
  });

  it("503-style error when encryption is not configured", async () => {
    const { controller } = make(undefined, null);
    await expect(controller.submitTemplate(fakeDb([]).db, CHANNEL, body, req)).rejects.toMatchObject({ name: "EncryptionNotConfiguredError" });
  });

  it("propagates provider errors without storing anything", async () => {
    const { db, inserts } = fakeDb([[channelRow()], []]);
    const { controller } = make({ submitTemplate: vi.fn().mockRejectedValue(new ExternalProviderError("gupshup", "Gupshup rejected the template")) });
    await expect(controller.submitTemplate(db, CHANNEL, body, req)).rejects.toBeInstanceOf(ExternalProviderError);
    expect(inserts).toHaveLength(0);
  });
});

describe("PUT /channels/:id/partner-credentials", () => {
  const row = (o: Record<string, unknown> = {}) => ({
    id: CHANNEL, tenantId: TENANT, provider: "gupshup", phoneE164: "+5491140000000", externalAppId: "DemoApp", status: "active",
    webhookToken: "wh", credentialsEncrypted: null, gupshupAppId: "app-9", partnerTokenEncrypted: Buffer.from("cipher"),
    createdAt: new Date("2026-10-20T00:00:00Z"), updatedAt: new Date("2026-10-20T00:00:00Z"), ...o,
  });
  const dbReturning = (rows: unknown[]) => {
    const inserts: unknown[] = [];
    const tx = {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => rows }) }) }),
      insert: () => ({ values: (v: unknown) => { inserts.push(v); return Promise.resolve(); } }),
    };
    return { inserts, db: { tenantId: TENANT, userId: "u", run: <T>(fn: (t: Transaction) => Promise<T>) => fn(tx as unknown as Transaction) } as unknown as TenantDb };
  };

  it("encrypts the token, never returns it and audits only the app id", async () => {
    const { controller, cipher } = make();
    const { db, inserts } = dbReturning([row()]);
    const out = await controller.setPartnerCredentials(db, CHANNEL, { gupshupAppId: "app-9", partnerToken: PARTNER }, req);
    expect(cipher?.encrypt).toHaveBeenCalledWith(PARTNER, { tenantId: TENANT, purpose: "gupshup_partner_token" });
    expect(out).toMatchObject({ gupshupAppId: "app-9", partnerConfigured: true });
    expect(JSON.stringify(out) + JSON.stringify(inserts)).not.toContain(PARTNER);
  });

  it("404 for an unknown channel and 400 for a short token", async () => {
    const { controller } = make();
    await expect(controller.setPartnerCredentials(dbReturning([]).db, CHANNEL, { gupshupAppId: "a", partnerToken: PARTNER }, req)).rejects.toBeInstanceOf(NotFoundError);
    await expect(controller.setPartnerCredentials(dbReturning([row()]).db, CHANNEL, { gupshupAppId: "a", partnerToken: "x" }, req)).rejects.toBeInstanceOf(ValidationError);
  });
});
