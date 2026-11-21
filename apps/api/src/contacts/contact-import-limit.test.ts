import { PlanLimitExceededError } from "@crmwsp/contracts";
import type { Transaction } from "@crmwsp/db";
import { describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { ContactBulkController } from "./contact-bulk.controller.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const req = { ip: "127.0.0.1" } as unknown as HttpRequest;

/** Every select returns `known` phones; inserts are recorded. */
function fakeDb(known: string[]) {
  const inserts: unknown[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: async () => known.map((phoneE164) => ({ phoneE164 })) }) }),
    insert: () => {
      inserts.push(1);
      throw new Error("insert must not run");
    },
  };
  const db = { tenantId: TENANT, userId: "user-1", run: <T>(fn: (t: Transaction) => Promise<T>) => fn(tx as unknown as Transaction) } as unknown as TenantDb;
  return { db, inserts };
}

const csv = "phone,name\n+59170000001,Ana\n+59170000002,Beto\n+59170000003,Caro\n";

describe("POST /contact-book/import plan limit", () => {
  it("refuses the whole import with 402 and the requested/remaining counts when new phones exceed the plan", async () => {
    const limits = {
      lock: vi.fn(async () => undefined),
      assert: vi.fn(async () => {
        throw new PlanLimitExceededError("Plan Start: contacts limit_reached", { details: { key: "contacts", limit: 10, used: 9, reason: "limit_reached" } });
      }),
    };
    const controller = new ContactBulkController(limits);
    const { db, inserts } = fakeDb(["+59170000001"]);
    const err = await controller.import(db, req, { csv }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLimitExceededError);
    expect((err as PlanLimitExceededError).details).toMatchObject({ key: "contacts", requested: 2, remaining: 1, limit: 10 });
    expect(limits.assert).toHaveBeenCalledWith(TENANT, "contacts", 2, expect.anything());
    expect(limits.lock).toHaveBeenCalledWith(expect.anything(), TENANT, "contacts");
    expect(inserts).toHaveLength(0);
  });

  it("counts a phone repeated in the file once (F5)", async () => {
    const limits = { lock: vi.fn(async () => undefined), assert: vi.fn(async () => undefined) };
    const controller = new ContactBulkController(limits);
    const dup = "phone,name\n+59170000001,Ana\n+591 7000 0001,Ana bis\n+59170000002,Beto\n+59170000002,Beto\n";
    const { db } = fakeDb([]);
    await controller.import(db, req, { csv: dup }).catch(() => undefined);
    expect(limits.assert).toHaveBeenCalledWith(TENANT, "contacts", 2, expect.anything());
  });

  it("does not consult the limit when every phone already exists (update-only import)", async () => {
    const limits = { lock: vi.fn(async () => undefined), assert: vi.fn(async () => undefined) };
    const controller = new ContactBulkController(limits);
    const { db } = fakeDb(["+59170000001", "+59170000002", "+59170000003"]);
    await controller.import(db, req, { csv }).catch(() => undefined);
    expect(limits.assert).not.toHaveBeenCalled();
  });
});
