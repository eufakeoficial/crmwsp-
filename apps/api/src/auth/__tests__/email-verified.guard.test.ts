import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { EmailVerifiedGuard } from "../email-verified.guard.js";

const ctx = (req: Record<string, unknown>) =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

const tenantDb = (ok: boolean | undefined) => ({
  tenantId: "t1",
  run: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: async () => (ok === undefined ? [] : [{ ok }]) }),
});

describe("EmailVerifiedGuard", () => {
  it("lets a tenant whose owner verified their email connect", async () => {
    await expect(new EmailVerifiedGuard().canActivate(ctx({ tenantDb: tenantDb(true) }))).resolves.toBe(true);
  });

  it("rejects with 403 EMAIL_NOT_VERIFIED while the owner is unverified", async () => {
    await expect(new EmailVerifiedGuard().canActivate(ctx({ tenantDb: tenantDb(false) }))).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      httpStatus: 403,
    });
  });

  it("fails closed when the check returns nothing", async () => {
    await expect(new EmailVerifiedGuard().canActivate(ctx({ tenantDb: tenantDb(undefined) }))).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
  });

  it("requires the tenant context (TenantGuard first)", async () => {
    await expect(new EmailVerifiedGuard().canActivate(ctx({}))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
