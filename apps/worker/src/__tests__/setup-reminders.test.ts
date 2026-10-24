import type { Database } from "@crmwsp/db";
import { describe, expect, it, vi } from "vitest";
import { runSetupReminders } from "../subscription-billing/index.js";

const ends = new Date("2026-11-08T12:00:00Z");
const db = (rows: unknown[]) => ({ execute: vi.fn(async () => rows) }) as unknown as Database;

describe("runSetupReminders", () => {
  it("emails each claimed owner once and skips tenants without an owner email", async () => {
    const send = vi.fn(async () => undefined);
    const n = await runSetupReminders({
      db: db([
        { tenant_id: "t1", tenant_name: "Uno", owner_email: "a@x.test", setup_ends_at: ends.toISOString() },
        { tenant_id: "t2", tenant_name: "Dos", owner_email: null, setup_ends_at: ends },
      ]),
      sendSetupReminder: send,
    });
    expect(n).toBe(1);
    expect(send).toHaveBeenCalledWith({ tenantId: "t1", tenantName: "Uno", ownerEmail: "a@x.test", setupEndsAt: ends });
  });

  it("is off without a sender and survives a failed send", async () => {
    const d = db([{ tenant_id: "t1", tenant_name: "Uno", owner_email: "a@x.test", setup_ends_at: ends }]);
    expect(await runSetupReminders({ db: d })).toBe(0);
    expect(d.execute).not.toHaveBeenCalled();
    const failing = vi.fn(async () => {
      throw new Error("smtp down");
    });
    expect(await runSetupReminders({ db: d, sendSetupReminder: failing, logger: { info() {}, warn() {}, error() {} } })).toBe(0);
  });
});
