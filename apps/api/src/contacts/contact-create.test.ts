import { ConflictError, PlanLimitExceededError, ValidationError } from "@crmwsp/contracts";
import type { Transaction } from "@crmwsp/db";
import { describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { ContactCreateController } from "./contact-create.controller.js";

vi.mock("../inbox/audit.js", async (orig) => ({ ...(await orig<typeof import("../inbox/audit.js")>()), writeAudit: vi.fn(async () => undefined) }));

const TENANT = "00000000-0000-4000-8000-000000000001";
const req = { ip: "127.0.0.1" } as unknown as HttpRequest;
const now = new Date("2026-01-01T00:00:00Z");

function fake(existing: { id: string }[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: async () => existing }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { returning: async () => [{ id: "c-1", tags: [], extracted: {}, name: null, createdAt: now, updatedAt: now, ...v }] };
      },
    }),
  };
  const db = { tenantId: TENANT, userId: "u-1", run: <T>(fn: (t: Transaction) => Promise<T>) => fn(tx as unknown as Transaction) } as unknown as TenantDb;
  return { db, inserted };
}
const okLimits = () => ({ lock: vi.fn(async () => undefined), assert: vi.fn(async () => undefined) });

describe("POST /contacts", () => {
  it("normalizes the phone to E.164, checks the contacts limit under lock and inserts", async () => {
    const limits = okLimits();
    const { db, inserted } = fake();
    const out = await new ContactCreateController(limits).create(db, { phone: "00 591 7000-0001", name: " Ana ", email: "a@x.co" }, req);
    expect(out).toMatchObject({ id: "c-1", phoneE164: "+59170000001", name: "Ana" });
    expect(inserted[0]).toMatchObject({ tenantId: TENANT, phoneE164: "+59170000001", extracted: { email: "a@x.co" } });
    expect(limits.lock).toHaveBeenCalledWith(expect.anything(), TENANT, "contacts");
    expect(limits.assert).toHaveBeenCalledWith(TENANT, "contacts", 1, expect.anything());
  });

  it("answers 409 pointing to the existing contact and does not consume the limit", async () => {
    const limits = okLimits();
    const { db, inserted } = fake([{ id: "existing-1" }]);
    const err = await new ContactCreateController(limits).create(db, { phone: "+59170000001" }, req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).details).toEqual({ contactId: "existing-1" });
    expect(limits.assert).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("rejects phones that are not valid E.164 even after normalization", async () => {
    const { db } = fake();
    const err = await new ContactCreateController(okLimits()).create(db, { phone: "abc-123-xyz" }, req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
  });

  it("propagates the plan limit error without inserting", async () => {
    const limits = {
      lock: vi.fn(async () => undefined),
      assert: vi.fn(async () => {
        throw new PlanLimitExceededError("limit");
      }),
    };
    const { db, inserted } = fake();
    await expect(new ContactCreateController(limits).create(db, { phone: "+59170000002" }, req)).rejects.toBeInstanceOf(PlanLimitExceededError);
    expect(inserted).toHaveLength(0);
  });
});
