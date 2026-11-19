import { describe, expect, it, vi } from "vitest";
import type { CipherBox } from "@crmwsp/crypto";
import { NotFoundError, ValidationError } from "@crmwsp/contracts";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import type { HttpRequest } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { ChannelsController, type GupshupCredentialVerifier } from "./channels.controller.js";

const ID = "6f1c0b52-6f0f-4f5c-9a43-1d2f3a4b5c6d";
const BODY = { appName: "DemoApp", apiKey: "sk_new_key_12345678" };
const req = { ip: "127.0.0.1" } as unknown as HttpRequest;
const REACHED = new Error("reached update");
const valid: GupshupCredentialVerifier = vi.fn(async () => ({ status: "valid" as const }));

function make(verify: GupshupCredentialVerifier, provider: string | null = "gupshup") {
  const cipher = { encrypt: vi.fn(() => Buffer.from("c")), decrypt: vi.fn() } as unknown as CipherBox;
  let calls = 0;
  const run = vi.fn(async () => {
    calls += 1;
    if (calls === 1) return provider ? { provider } : undefined; // channel lookup
    throw REACHED; // the update transaction
  });
  const db = { tenantId: "t1", userId: "u1", run } as unknown as TenantDb;
  const controller = new ChannelsController(cipher, {} as WhatsAppProvider, null, {} as never, undefined, verify);
  return { controller, db, run, cipher };
}

describe("PATCH /channels/:id/credentials", () => {
  it("rejects a bad id and an unknown channel", async () => {
    const { controller, db } = make(valid);
    await expect(controller.updateCredentials(db, "nope", BODY, req)).rejects.toBeInstanceOf(NotFoundError);
    const missing = make(valid, null);
    await expect(missing.controller.updateCredentials(missing.db, ID, BODY, req)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only Gupshup channels are editable", async () => {
    const { controller, db, cipher } = make(valid, "360dialog");
    await expect(controller.updateCredentials(db, ID, BODY, req)).rejects.toBeInstanceOf(ValidationError);
    expect(cipher.encrypt).not.toHaveBeenCalled();
  });

  it("invalid key: nothing is encrypted or saved", async () => {
    const { controller, db, run, cipher } = make(vi.fn(async () => ({ status: "invalid_credentials" as const })));
    await expect(controller.updateCredentials(db, ID, BODY, req)).rejects.toThrow("La API key no es válida");
    expect(run).toHaveBeenCalledOnce(); // only the lookup
    expect(cipher.encrypt).not.toHaveBeenCalled();
  });

  it.each([{ status: "valid" as const }, { status: "unverified" as const, reason: "network error" }])("%j encrypts and saves", async (result) => {
    const verify = vi.fn(async () => result);
    const { controller, db, cipher } = make(verify);
    await expect(controller.updateCredentials(db, ID, BODY, req)).rejects.toBe(REACHED);
    expect(verify).toHaveBeenCalledWith(BODY.apiKey, BODY.appName);
    expect(cipher.encrypt).toHaveBeenCalledWith(BODY.apiKey, { tenantId: "t1", purpose: "gupshup_api_key" });
  });

  describe("partner credentials on app change", () => {
    async function runUpdate(currentApp: string | undefined) {
      const sets: Record<string, unknown>[] = [];
      const audits: unknown[] = [];
      const row = { id: ID, provider: "gupshup", status: "active", externalAppId: BODY.appName, gupshupAppId: null, partnerTokenEncrypted: null };
      const tx = {
        update: () => ({ set: (v: Record<string, unknown>) => (sets.push(v), { where: () => ({ returning: async () => [row] }) }) }),
        insert: () => ({ values: async (v: unknown) => (audits.push(v), undefined) }),
      };
      let calls = 0;
      const run = vi.fn(async (fn: (t: unknown) => unknown) => {
        calls += 1;
        return calls === 1 ? { provider: "gupshup", appName: currentApp } : fn(tx);
      });
      const cipher = { encrypt: vi.fn(() => Buffer.from("c")), decrypt: vi.fn() } as unknown as CipherBox;
      const db = { tenantId: "t1", userId: "u1", run } as unknown as TenantDb;
      const controller = new ChannelsController(cipher, {} as WhatsAppProvider, null, {} as never, undefined, valid);
      await controller.updateCredentials(db, ID, BODY, req).catch(() => undefined);
      return { sets, audits };
    }

    it("clears the partner app id and token when the app name changes", async () => {
      const { sets, audits } = await runUpdate("OldApp");
      expect(sets[0]).toMatchObject({ externalAppId: BODY.appName, gupshupAppId: null, partnerTokenEncrypted: null });
      expect(JSON.stringify(audits)).toContain("partnerCleared");
      expect(JSON.stringify(audits)).not.toContain(BODY.apiKey);
    });

    it("keeps them when only the key changes", async () => {
      const { sets, audits } = await runUpdate(BODY.appName);
      expect(sets[0]).not.toHaveProperty("gupshupAppId");
      expect(sets[0]).not.toHaveProperty("partnerTokenEncrypted");
      expect(JSON.stringify(audits)).not.toContain("partnerCleared");
    });
  });
});
