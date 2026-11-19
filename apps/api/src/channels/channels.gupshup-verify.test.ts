import { describe, expect, it, vi } from "vitest";
import type { CipherBox } from "@crmwsp/crypto";
import { ValidationError } from "@crmwsp/contracts";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import type { HttpRequest } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { ChannelsController, type GupshupCredentialVerifier } from "./channels.controller.js";

const BODY = { phoneE164: "+5491140000000", appName: "DemoApp", apiKey: "sk_demo_key_12345678" };
const req = { ip: "127.0.0.1" } as unknown as HttpRequest;
const REACHED = new Error("reached db");

function make(verify: GupshupCredentialVerifier) {
  const cipher = { encrypt: vi.fn(() => Buffer.from("c")), decrypt: vi.fn() } as unknown as CipherBox;
  const limits = { assert: vi.fn(), lock: vi.fn(), startTrialIfEligible: vi.fn() };
  const run = vi.fn(async () => {
    throw REACHED;
  });
  const db = { tenantId: "t1", userId: "u1", run } as unknown as TenantDb;
  const controller = new ChannelsController(cipher, {} as WhatsAppProvider, null, limits as never, undefined, verify);
  return { controller, db, run, cipher };
}

describe("POST /channels/gupshup credential check", () => {
  it("invalid key: ValidationError, nothing encrypted or saved", async () => {
    const { controller, db, run, cipher } = make(vi.fn(async () => ({ status: "invalid_credentials" as const })));
    const err = await controller.createGupshup(db, BODY, req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe("La API key no es válida para esa cuenta de Gupshup.");
    expect(run).not.toHaveBeenCalled();
    expect(cipher.encrypt).not.toHaveBeenCalled();
  });

  it("invalid app: ValidationError, nothing saved", async () => {
    const { controller, db, run } = make(vi.fn(async () => ({ status: "invalid_app" as const })));
    await expect(controller.createGupshup(db, BODY, req)).rejects.toThrow("No existe una app de Gupshup");
    expect(run).not.toHaveBeenCalled();
  });

  it.each([{ status: "valid" as const }, { status: "unverified" as const, reason: "network error" }])("%j proceeds to save", async (result) => {
    const { controller, db, run } = make(vi.fn(async () => result));
    await expect(controller.createGupshup(db, BODY, req)).rejects.toBe(REACHED);
    expect(run).toHaveBeenCalledOnce();
  });

  it("a throwing verifier never blocks the connect", async () => {
    const { controller, db } = make(vi.fn(async () => {
      throw new Error("x");
    }));
    await expect(controller.createGupshup(db, BODY, req)).rejects.toBe(REACHED);
  });
});
