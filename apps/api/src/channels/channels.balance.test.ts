import { afterEach, describe, expect, it, vi } from "vitest";
import type { CipherBox } from "@crmwsp/crypto";
import { NotFoundError } from "@crmwsp/contracts";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import type { TenantDb } from "../db/tenant-db.js";
import { ChannelsController, WALLET_CACHE_TTL_MS, type GupshupWalletReader } from "./channels.controller.js";

const ID = "6f1c0b52-6f0f-4f5c-9a43-1d2f3a4b5c6d";
const GUPSHUP = { provider: "gupshup", appId: "app-1" as string | null, partnerToken: Buffer.from("c") as Buffer | null };

function make(reader: GupshupWalletReader | undefined, channel: { provider: string; appId: string | null; partnerToken: Buffer | null } | null = GUPSHUP) {
  const cipher = { encrypt: vi.fn(), decrypt: vi.fn(() => "plain-token-123456") } as unknown as CipherBox;
  const db = { tenantId: "t1", userId: "u1", run: vi.fn(async () => channel ?? undefined) } as unknown as TenantDb;
  const controller = new ChannelsController(cipher, {} as WhatsAppProvider, null, {} as never, undefined, undefined, reader);
  return { controller, db, cipher };
}

afterEach(() => vi.useRealTimers());

describe("GET /channels/:id/balance", () => {
  it("returns the balance with the low flag (USD under 2)", async () => {
    const reader = vi.fn(async () => ({ amount: 1.2, currency: "USD" }));
    const { controller, db, cipher } = make(reader);
    expect(await controller.balance(db, ID)).toEqual({ status: "ok", amount: 1.2, currency: "USD", low: true });
    expect(reader).toHaveBeenCalledWith({ appId: "app-1", partnerToken: "plain-token-123456" });
    expect(cipher.decrypt).toHaveBeenCalledWith(expect.anything(), { tenantId: "t1", purpose: "gupshup_partner_token" });
  });

  it("is not low at or above the threshold", async () => {
    const { controller, db } = make(vi.fn(async () => ({ amount: 2, currency: "USD" })));
    expect(await controller.balance(db, ID)).toMatchObject({ status: "ok", low: false });
  });

  it("caches for 5 minutes, then asks Gupshup again", async () => {
    vi.useFakeTimers();
    const reader = vi.fn(async () => ({ amount: 5, currency: "USD" }));
    const { controller, db } = make(reader);
    await controller.balance(db, ID);
    await controller.balance(db, ID);
    expect(reader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(WALLET_CACHE_TTL_MS + 1);
    await controller.balance(db, ID);
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("unknown shape, reader failure or missing reader answer unavailable, never an error", async () => {
    const unknown = make(vi.fn(async () => null));
    expect(await unknown.controller.balance(unknown.db, ID)).toEqual({ status: "unavailable" });
    const failing = make(
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(await failing.controller.balance(failing.db, ID)).toEqual({ status: "unavailable" });
    const none = make(undefined);
    expect(await none.controller.balance(none.db, ID)).toEqual({ status: "unavailable" });
  });

  it("a Gupshup channel without Partner credentials answers partner_required and never calls the reader", async () => {
    const reader = vi.fn();
    const noToken = make(reader, { provider: "gupshup", appId: "app-1", partnerToken: null });
    expect(await noToken.controller.balance(noToken.db, ID)).toEqual({ status: "partner_required" });
    const noApp = make(reader, { provider: "gupshup", appId: null, partnerToken: Buffer.from("c") });
    expect(await noApp.controller.balance(noApp.db, ID)).toEqual({ status: "partner_required" });
    expect(reader).not.toHaveBeenCalled();
  });

  it("360dialog channels are unavailable; unknown channel or bad id are 404", async () => {
    const d = make(vi.fn(), { provider: "360dialog", appId: null, partnerToken: null });
    expect(await d.controller.balance(d.db, ID)).toEqual({ status: "unavailable" });
    const missing = make(vi.fn(), null);
    await expect(missing.controller.balance(missing.db, ID)).rejects.toBeInstanceOf(NotFoundError);
    await expect(missing.controller.balance(missing.db, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
