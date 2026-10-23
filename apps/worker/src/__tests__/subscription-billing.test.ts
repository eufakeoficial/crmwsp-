import type { Database, Transaction } from "@crmwsp/db";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { isSubscriptionRestricted, runSubscriptionReconcileTick, settleSubscriptionEvent } from "../subscription-billing/index.js";

const now = new Date("2026-10-23T12:00:00Z");
const txWith = (d: string | null) => ({ execute: vi.fn(async () => [{ d }]) }) as unknown as Transaction;

describe("subscription billing worker", () => {
  it("restricts only after the grace period; never-paid tenants are not restricted", async () => {
    expect(await isSubscriptionRestricted(txWith(null), now)).toBe(false);
    expect(await isSubscriptionRestricted(txWith("2026-10-22"), now)).toBe(false);
    expect(await isSubscriptionRestricted(txWith("2026-10-19"), now)).toBe(true);
  });

  it("reconciliation is a no-op without a provider (no DB access)", async () => {
    const db = { execute: vi.fn() } as unknown as Database;
    expect(await runSubscriptionReconcileTick({ db, provider: null })).toEqual({ polled: 0, settled: 0, failed: 0 });
    expect((db as unknown as { execute: ReturnType<typeof vi.fn> }).execute).not.toHaveBeenCalled();
  });

  it("one failing charge does not stop the tick", async () => {
    const db = {
      execute: vi.fn(async () => [
        { charge_id: "00000000-0000-4000-8000-000000000001", tenant_id: "00000000-0000-4000-8000-000000000002", provider_payment_id: "1" },
      ]),
    } as unknown as Database;
    const provider = { getPayment: vi.fn(async () => Promise.reject(new Error("down"))) };
    expect(await runSubscriptionReconcileTick({ db, provider })).toEqual({ polled: 1, settled: 0, failed: 1 });
  });

  it("rejects invalid job data as unrecoverable", async () => {
    await expect(settleSubscriptionEvent({ db: {} as Database, provider: null }, { eventId: "x" })).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
