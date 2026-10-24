import { SetupRequiredError } from "@crmwsp/contracts";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ActivationGuard } from "./activation.guard.js";

const ctx = (method: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ method, tenant: { id: "t1", role: "owner" } }) }) }) as unknown as ExecutionContext;

describe("ActivationGuard", () => {
  it("lets reads through and blocks writes of a tenant in setup", async () => {
    const limits = { assertNotInSetup: vi.fn(async () => { throw new SetupRequiredError(); }) };
    const guard = new ActivationGuard(limits);
    await expect(guard.canActivate(ctx("GET"))).resolves.toBe(true);
    expect(limits.assertNotInSetup).not.toHaveBeenCalled();
    await expect(guard.canActivate(ctx("POST"))).rejects.toMatchObject({ code: "SETUP_REQUIRED", httpStatus: 402 });
  });
  it("allows writes once the tenant left setup", async () => {
    const guard = new ActivationGuard({ assertNotInSetup: vi.fn(async () => undefined) });
    await expect(guard.canActivate(ctx("PATCH"))).resolves.toBe(true);
  });
});
