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
  sql: () => ({}),
}));

const { PlanLimitsService } = await import("./plan-limits.service.js");
const svc = new PlanLimitsService({} as DbHandle);
let paidUntil: string | null = null;
const tx = { execute: vi.fn(async () => [{ d: paidUntil }]) } as unknown as Transaction;
const T = "00000000-0000-4000-8000-000000000001";

describe("PlanLimitsService", () => {
  it("assertSubscriptionActive blocks only a subscription restricted past grace", async () => {
    paidUntil = null; // unbilled
    await expect(svc.assertSubscriptionActive(T, tx)).resolves.toBeUndefined();
    paidUntil = new Date().toISOString().slice(0, 10); // active
    await expect(svc.assertSubscriptionActive(T, tx)).resolves.toBeUndefined();
    paidUntil = "2000-01-01"; // restricted
    const err = await svc.assertSubscriptionActive(T, tx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLimitExceededError);
    expect((err as PlanLimitExceededError).httpStatus).toBe(402);
    expect((err as PlanLimitExceededError).details).toMatchObject({ reason: "subscription_restricted" });
    paidUntil = null;
  });

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

  it("a subscription lapsed past the grace period restricts every limit (nothing deleted)", async () => {
    paidUntil = "2020-01-01";
    try {
      const err = await svc.assert(T, "ai_messages", 1, tx).catch((e: unknown) => e);
      expect((err as PlanLimitExceededError).details).toMatchObject({ key: "ai_messages", reason: "not_included" });
      const r = await svc.snapshot(tx);
      expect(r.subscription).toMatchObject({ access: "restricted", paidUntil: "2020-01-01" });
    } finally {
      paidUntil = null;
    }
  });

  it("snapshot exposes plan, period and usage without a billing provider", async () => {
    const r = await svc.snapshot(tx);
    expect(r.plan).toMatchObject({ id: "start", priceMonthlyUsd: 49 });
    expect(r.billingProvider).toBe("none");
    expect(r.subscription).toMatchObject({ access: "unbilled", paidUntil: null });
    expect(r.usage.find((u) => u.key === "ai_messages")).toMatchObject({ monthly: true, limit: 2_000, used: 1_999 });
  });
});
