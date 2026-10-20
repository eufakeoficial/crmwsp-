import { randomUUID } from "node:crypto";
import { PlanLimitExceededError } from "@crmwsp/contracts";
import type { Transaction } from "@crmwsp/db";
import { describe, expect, it, vi } from "vitest";
import { planRecipients } from "../broadcasts/audience.js";
import { BroadcastsController } from "../broadcasts/broadcasts.controller.js";
import type { PlanLimitsService } from "../billing/plan-limits.service.js";
import type { TenantDb } from "../db/tenant-db.js";
import type { HttpRequest } from "../common/http.js";

const contact = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  phoneE164: `+3460000${id}`,
  name: `N${id}`,
  tags: ["vip"],
  extracted: {},
  marketingConsent: "granted" as "granted" | "revoked" | null,
  ...over,
});

describe("planRecipients", () => {
  it("keeps only opted-in contacts, dedupes by phone and resolves params", () => {
    const plan = planRecipients(
      [contact("1"), contact("2", { marketingConsent: null }), contact("3", { phoneE164: "+346 0000 1" }), contact("4", { name: null })],
      { tags: ["vip"], excludeTags: [] },
      [{ source: "contact_name" }],
    );
    expect(plan.recipients).toEqual([{ contactId: "1", phoneE164: "+34600001", params: ["N1"] }]);
    expect(plan.excludedNoConsent).toBe(1);
    expect(plan.duplicates).toBe(1);
    expect(plan.missingVariables).toBe(1);
  });
});

/** Chainable query fake: every awaited query pops the next queued result. */
function fakeTx(results: unknown[]) {
  const inserts: unknown[] = [];
  const chain = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          const value = results.shift();
          return (resolve: (v: unknown) => void) => resolve(value);
        }
        if (prop === "values") return (v: unknown) => (inserts.push(v), chain());
        return () => chain();
      },
    });
  return { tx: { select: chain, insert: chain, update: chain, delete: chain, execute: chain } as unknown as Transaction, inserts };
}

describe("BroadcastsController.schedule", () => {
  const id = randomUUID();
  const draft = {
    id,
    tenantId: "t",
    name: "Promo",
    channelConnectionId: "ch",
    templateId: randomUUID(),
    variableMapping: [],
    audience: { tags: [], excludeTags: [] },
    status: "draft",
    reservedSends: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const template = { status: "approved", channel: "ch", body: "Hola", externalId: "gs-1" };
  const req = { ip: "" } as HttpRequest;

  it("blocks with a 402 plan error and writes no recipients when the cap is exceeded (Start = 0)", async () => {
    const { tx, inserts } = fakeTx([[draft], [template], [{ ...contact("1"), consent: "granted" }]]);
    const db = { tenantId: "t", userId: "u", run: (fn: (t: Transaction) => Promise<unknown>) => fn(tx) } as unknown as TenantDb;
    const consume = vi.fn(async () => {
      throw new PlanLimitExceededError("Plan Start: broadcast_sends limit_reached");
    });
    const ctl = new BroadcastsController({ consume } as unknown as PlanLimitsService);
    await expect(ctl.schedule(db, id, {}, req)).rejects.toBeInstanceOf(PlanLimitExceededError);
    expect(consume).toHaveBeenCalledWith("t", "broadcast_sends", 1, tx);
    expect(inserts).toEqual([]);
  });

  it("refuses to schedule a campaign that is not a draft", async () => {
    const { tx } = fakeTx([[{ ...draft, status: "sending" }]]);
    const db = { tenantId: "t", userId: "u", run: (fn: (t: Transaction) => Promise<unknown>) => fn(tx) } as unknown as TenantDb;
    const ctl = new BroadcastsController({ consume: vi.fn() } as unknown as PlanLimitsService);
    await expect(ctl.schedule(db, id, {}, req)).rejects.toThrow(/sending/);
  });
});
