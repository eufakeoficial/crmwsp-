import "reflect-metadata";
import type { CipherBox } from "@crmwsp/crypto";
import type { Transaction } from "@crmwsp/db";
import { NotFoundError, ValidationError } from "@crmwsp/contracts";
import type { GupshupProfileClient } from "@crmwsp/whatsapp";
import { describe, expect, it, vi } from "vitest";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { MISSING_PARTNER_CREDENTIALS_MESSAGE, WhatsappProfileController, sniffProfileImage } from "./whatsapp-profile.controller.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const CHANNEL = "00000000-0000-4000-8000-0000000000c1";
const PARTNER = "partner_TOKEN_secret_xyz";
const req = { ip: "127.0.0.1" } as unknown as HttpRequest;

/** Queue-driven fake transaction: select() resolves to the next queued rows; insert() (audit) is recorded. */
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
    insert: () => ({ values: (v: Record<string, unknown>) => { inserts.push(v); return Promise.resolve(undefined); } }),
  };
  const db = { tenantId: TENANT, userId: "user-1", run: <T>(fn: (t: Transaction) => Promise<T>) => fn(tx as unknown as Transaction) } as unknown as TenantDb;
  return { db, inserts };
}

const channel = (o: Record<string, unknown> = {}) => ({ provider: "gupshup", appId: "app-1", token: Buffer.from("enc"), ...o });

function make() {
  const client = {
    getProfile: vi.fn(async () => ({ about: "a", description: null, address: null, email: null, website1: null, website2: null, vertical: null, photoUrl: null })),
    updateProfile: vi.fn(async () => undefined),
    updatePhoto: vi.fn(async () => undefined),
    requestDisplayName: vi.fn(async () => undefined),
  };
  const cipher = { decrypt: vi.fn(() => PARTNER), encrypt: vi.fn() } as unknown as CipherBox;
  return { controller: new WhatsappProfileController(cipher, client as unknown as GupshupProfileClient), client, cipher };
}

function multipartReq(file: Buffer | null): HttpRequest {
  async function* parts() {
    if (file) {
      yield {
        type: "file",
        fieldname: "file",
        file: (async function* () { yield file; })(),
        toBuffer: async () => file,
      };
    }
  }
  return { ip: "127.0.0.1", parts } as unknown as HttpRequest;
}

describe("WhatsappProfileController", () => {
  it("is protected by the tenant guard", () => {
    expect(Reflect.getMetadata("__guards__", WhatsappProfileController)).toContain(TenantGuard);
  });

  it("returns a clear Spanish error when the channel has no partner credentials", async () => {
    const { controller, client } = make();
    for (const row of [channel({ appId: null }), channel({ token: null })]) {
      const { db } = fakeDb([[row]]);
      const err = await controller.get(db, CHANNEL).catch((e: unknown) => e as Error);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error).message).toBe(MISSING_PARTNER_CREDENTIALS_MESSAGE);
    }
    expect(client.getProfile).not.toHaveBeenCalled();
  });

  it("404s for unknown channels (RLS hides other tenants) and malformed ids", async () => {
    const { controller } = make();
    await expect(controller.get(fakeDb([[]]).db, CHANNEL)).rejects.toBeInstanceOf(NotFoundError);
    await expect(controller.get(fakeDb([]).db, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects non-gupshup channels", async () => {
    const { controller } = make();
    await expect(controller.get(fakeDb([[channel({ provider: "360dialog" })]]).db, CHANNEL)).rejects.toBeInstanceOf(ValidationError);
  });

  it("decrypts the token with the tenant AAD and reads the profile", async () => {
    const { controller, client, cipher } = make();
    const out = await controller.get(fakeDb([[channel()]]).db, CHANNEL);
    expect(out.about).toBe("a");
    expect(cipher.decrypt).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT, purpose: "gupshup_partner_token" });
    expect(client.getProfile).toHaveBeenCalledWith({ appId: "app-1", token: PARTNER });
  });

  it("updates only provided fields, validates input and audits without secrets", async () => {
    const { controller, client } = make();
    const { db, inserts } = fakeDb([[channel()]]);
    await controller.update(db, CHANNEL, { description: "Hola", vertical: "RETAIL" }, req);
    expect(client.updateProfile).toHaveBeenCalledWith({ appId: "app-1", token: PARTNER }, { description: "Hola", vertical: "RETAIL" });
    expect(inserts).toHaveLength(1);
    expect(JSON.stringify(inserts)).not.toContain(PARTNER);
    await expect(controller.update(fakeDb([[channel()]]).db, CHANNEL, {}, req)).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.update(fakeDb([[channel()]]).db, CHANNEL, { website1: "javascript:alert(1)" }, req)).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.update(fakeDb([[channel()]]).db, CHANNEL, { vertical: "NOPE" }, req)).rejects.toBeInstanceOf(ValidationError);
  });

  it("uploads a valid PNG and rejects other content", async () => {
    const { controller, client } = make();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(10)]);
    await controller.photo(fakeDb([[channel()]]).db, CHANNEL, multipartReq(png) as never);
    expect(client.updatePhoto).toHaveBeenCalledWith({ appId: "app-1", token: PARTNER }, expect.objectContaining({ mime: "image/png", filename: "profile.png" }));
    await expect(controller.photo(fakeDb([[channel()]]).db, CHANNEL, multipartReq(Buffer.from("GIF89a....")) as never)).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.photo(fakeDb([[channel()]]).db, CHANNEL, multipartReq(null) as never)).rejects.toBeInstanceOf(ValidationError);
  });

  it("requests a display name and validates its format", async () => {
    const { controller, client } = make();
    await controller.displayName(fakeDb([[channel()]]).db, CHANNEL, { displayName: "Mi Negocio" }, req);
    expect(client.requestDisplayName).toHaveBeenCalledWith({ appId: "app-1", token: PARTNER }, "Mi Negocio");
    await expect(controller.displayName(fakeDb([[channel()]]).db, CHANNEL, { displayName: "MI NEGOCIO" }, req)).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.displayName(fakeDb([[channel()]]).db, CHANNEL, { displayName: "ab" }, req)).rejects.toBeInstanceOf(ValidationError);
  });

  it("sniffs jpg/png only", () => {
    expect(sniffProfileImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(sniffProfileImage(Buffer.from("RIFF....WEBP"))).toBeNull();
  });
});
