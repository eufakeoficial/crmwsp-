import { PlanLimitExceededError } from "@crmwsp/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../auth/auth.service.js";
import type { DbHandle } from "../common/http.js";
import { InvitationAcceptService } from "./invitation-accept.service.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";

function make(assert: (...a: unknown[]) => Promise<void>) {
  const execute = vi.fn(async () => [{ tenant_id: TENANT, role: "agent" }]);
  const tx = { execute };
  const handle = { db: { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) } } as unknown as DbHandle;
  const limits = { assert: vi.fn(assert) };
  const svc = new InvitationAcceptService(handle, {} as AuthService, { limit: 100, windowMs: 60_000 }, limits);
  return { svc, limits };
}

describe("invitation accept re-checks seats", () => {
  it("accepts when the tenant is within its seat limit (books 0 extra seats: the invitation already held one)", async () => {
    const { svc, limits } = make(async () => undefined);
    await expect(svc.acceptAsUser("t".repeat(43), USER, { ip: "1.1.1.1" } as never)).resolves.toMatchObject({ tenantId: TENANT });
    expect(limits.assert).toHaveBeenCalledWith(TENANT, "seats", 0, expect.anything());
  });

  it("rolls back with 402 when the plan shrank below the current seats", async () => {
    const { svc } = make(async () => {
      throw new PlanLimitExceededError("Plan Start: seats limit_reached");
    });
    await expect(svc.acceptAsUser("t".repeat(43), USER, { ip: "1.1.1.1" } as never)).rejects.toBeInstanceOf(PlanLimitExceededError);
  });
});
