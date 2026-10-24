import { PlanLimitExceededError, SetupRequiredError } from "@crmwsp/contracts";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { ActivationGuard, AllowLapsedWrite } from "./activation.guard.js";

class Handlers {
  write(): void {}
  @AllowLapsedWrite()
  cancel(): void {}
}

const ctx = (method: string, handler: keyof Handlers = "write") =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ method, tenant: { id: "t1", role: "owner" } }) }),
    getHandler: () => Handlers.prototype[handler],
    getClass: () => Handlers,
  }) as unknown as ExecutionContext;

const restricted = () =>
  new PlanLimitExceededError("Subscription expired", { details: { key: "subscription", reason: "subscription_restricted" } });

function limits(active: () => Promise<void>, notInSetup: () => Promise<void> = async () => undefined) {
  return { assertSubscriptionActive: vi.fn(active), assertNotInSetup: vi.fn(notInSetup) };
}

describe("ActivationGuard", () => {
  it("lets reads through without checking", async () => {
    const l = limits(async () => { throw new SetupRequiredError(); });
    const guard = new ActivationGuard(l, new Reflector());
    await expect(guard.canActivate(ctx("GET"))).resolves.toBe(true);
    expect(l.assertSubscriptionActive).not.toHaveBeenCalled();
  });

  it("blocks writes of a tenant in setup", async () => {
    const guard = new ActivationGuard(limits(async () => { throw new SetupRequiredError(); }), new Reflector());
    await expect(guard.canActivate(ctx("POST"))).rejects.toMatchObject({ code: "SETUP_REQUIRED", httpStatus: 402 });
  });

  it("blocks writes of a restricted or payment_required tenant (F3)", async () => {
    const guard = new ActivationGuard(limits(async () => { throw restricted(); }), new Reflector());
    await expect(guard.canActivate(ctx("PATCH"))).rejects.toMatchObject({ httpStatus: 402, details: { reason: "subscription_restricted" } });
  });

  it("allows writes for trial / active / grace / grandfathered tenants", async () => {
    const guard = new ActivationGuard(limits(async () => undefined), new Reflector());
    await expect(guard.canActivate(ctx("POST"))).resolves.toBe(true);
  });

  it("an @AllowLapsedWrite handler only enforces setup", async () => {
    const l = limits(async () => { throw restricted(); });
    const guard = new ActivationGuard(l, new Reflector());
    await expect(guard.canActivate(ctx("POST", "cancel"))).resolves.toBe(true);
    expect(l.assertNotInSetup).toHaveBeenCalledWith("t1");
    expect(l.assertSubscriptionActive).not.toHaveBeenCalled();
  });
});
