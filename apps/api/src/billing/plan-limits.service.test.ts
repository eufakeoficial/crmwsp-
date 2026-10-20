import { PlanLimitExceededError } from "@crmwsp/contracts";
import type { DbHandle, PlanUsageSnapshot, Transaction } from "@crmwsp/db";
import { describe, expect, it, vi } from "vitest";

const snapshot: PlanUsageSnapshot = {
  plan: null,
  limitsOverride: null,
  period: "2026-10",
  aiMessages: 1_999,
  broadcastSends: 0,
  contacts: 10_000,
  seats: 2,
  whatsappNumbers: 1,
};
vi.mock("@crmwsp/db", () => ({
  readPlanUsage: vi.fn(async () => snapshot),
  consumeUsage: vi.fn(async () => null),
  withTenant: vi.fn(),
}));

const { PlanLimitsService } = await import("./plan-limits.service.js");
const svc = new PlanLimitsService({} as DbHandle);
const tx = {} as Transaction;
const T = "00000000-0000-4000-8000-000000000001";

describe("PlanLimitsService", () => {
  it("assert passes under the limit (default plan start)", async () => {
    await expect(svc.assert(T, "ai_messages", 1, tx)).resolves.toBeUndefined();
    await expect(svc.assert(T, "seats", 3, tx)).resolves.toBeUndefined();
  });

  it("assert throws 402 when the limit is reached", async () => {
    const err = await svc.assert(T, "contacts", 1, tx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLimitExceededError);
    expect((err as PlanLimitExceededError).httpStatus).toBe(402);
    expect((err as PlanLimitExceededError).details).toMatchObject({ key: "contacts", limit: 10_000, reason: "limit_reached" });
  });

  it("assert reports features not included (broadcasts on start)", async () => {
    const err = await svc.assert(T, "broadcast_sends", 1, tx).catch((e: unknown) => e);
    expect((err as PlanLimitExceededError).details).toMatchObject({ reason: "not_included" });
  });

  it("consume throws when the atomic increment is refused", async () => {
    await expect(svc.consume(T, "broadcast_sends", 5, tx)).rejects.toBeInstanceOf(PlanLimitExceededError);
  });

  it("limits_override raises and lowers caps; null keeps the plan default", async () => {
    snapshot.limitsOverride = { contacts: 20_000, seats: 2, ai_messages: null };
    try {
      await expect(svc.assert(T, "contacts", 1, tx)).resolves.toBeUndefined();
      const err = await svc.assert(T, "seats", 1, tx).catch((e: unknown) => e);
      expect((err as PlanLimitExceededError).details).toMatchObject({ key: "seats", limit: 2, reason: "limit_reached" });
      await expect(svc.assert(T, "ai_messages", 1_000_000, tx)).resolves.toBeUndefined();
      const r = await svc.snapshot(tx);
      expect(r.usage.find((u) => u.key === "contacts")).toMatchObject({ limit: 20_000 });
      expect(r.usage.find((u) => u.key === "whatsapp_numbers")).toMatchObject({ limit: 2 });
    } finally {
      snapshot.limitsOverride = null;
    }
    const err = await svc.assert(T, "contacts", 1, tx).catch((e: unknown) => e);
    expect((err as PlanLimitExceededError).details).toMatchObject({ limit: 10_000 });
  });

  it("snapshot exposes plan, period and usage without a billing provider", async () => {
    const r = await svc.snapshot(tx);
    expect(r.plan).toMatchObject({ id: "start", priceMonthlyUsd: 49 });
    expect(r.billingProvider).toBe("none");
    expect(r.usage.find((u) => u.key === "ai_messages")).toMatchObject({ monthly: true, limit: 2_000, used: 1_999 });
  });
});
