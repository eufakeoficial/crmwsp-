import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ForbiddenError, VIEW_AS_HEADER, ValidationError, type MembershipRole } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import type { HttpRequest } from "../common/http.js";
import type { AuthService } from "./auth.service.js";
import { Roles } from "./decorators.js";
import { TenantGuard } from "./tenant.guard.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";

function setup(memberships: Record<string, MembershipRole | undefined>) {
  const auth = {
    listTenants: (userId: string) => {
      const role = memberships[userId];
      return Promise.resolve(role ? [{ id: TENANT, role, status: "active" }] : []);
    },
  } as unknown as AuthService;
  const audits: Array<{ actor: string; target: string }> = [];
  class TestGuard extends TenantGuard {
    protected override recordViewAs(req: HttpRequest): Promise<void> {
      audits.push({ actor: req.viewAs?.actorUserId ?? "", target: req.viewAs?.targetUserId ?? "" });
      return Promise.resolve();
    }
  }
  const guard = new TestGuard(auth, new Reflector(), { db: {} } as never);

  class AnyHandler {
    open(): void {}
    @Roles("owner", "admin")
    managersOnly(): void {}
  }
  const ctx = (method: string, headers: Record<string, string>, handler: "open" | "managersOnly") => {
    const req = { headers: { "x-tenant-id": TENANT, ...headers }, method, user: { id: ACTOR }, ip: "" } as unknown as HttpRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => AnyHandler.prototype[handler],
      getClass: () => AnyHandler,
    } as unknown as ExecutionContext;
    return { req, context };
  };
  return { guard, ctx, audits };
}

describe("TenantGuard read-only view-as", () => {
  it("answers as the target member: role and user id of the target, with the actor recorded", async () => {
    const { guard, ctx } = setup({ [ACTOR]: "owner", [TARGET]: "agent" });
    const { req, context } = ctx("GET", { [VIEW_AS_HEADER]: TARGET }, "open");
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.tenant).toEqual({ id: TENANT, role: "agent" });
    expect(req.viewAs).toEqual({ actorUserId: ACTOR, targetUserId: TARGET });
    expect(req.tenantDb?.userId).toBe(TARGET);
  });

  it("audits a view-as once per actor and target, even without the start endpoint", async () => {
    const { guard, ctx, audits } = setup({ [ACTOR]: "owner", [TARGET]: "agent" });
    await guard.canActivate(ctx("GET", { [VIEW_AS_HEADER]: TARGET }, "open").context);
    await guard.canActivate(ctx("GET", { [VIEW_AS_HEADER]: TARGET }, "open").context);
    expect(audits).toEqual([{ actor: ACTOR, target: TARGET }]);
  });

  it("does not audit refused attempts as views, nor normal requests", async () => {
    const { guard, ctx, audits } = setup({ [ACTOR]: "admin", [TARGET]: "owner" });
    await expect(guard.canActivate(ctx("GET", { [VIEW_AS_HEADER]: TARGET }, "open").context)).rejects.toBeInstanceOf(ForbiddenError);
    await guard.canActivate(ctx("GET", {}, "open").context);
    expect(audits).toEqual([]);
  });

  it("applies the target's role to @Roles, so a manager-only route is denied as an agent", async () => {
    const { guard, ctx } = setup({ [ACTOR]: "owner", [TARGET]: "agent" });
    await expect(guard.canActivate(ctx("GET", { [VIEW_AS_HEADER]: TARGET }, "managersOnly").context)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses every write while viewing as someone", async () => {
    const { guard, ctx } = setup({ [ACTOR]: "owner", [TARGET]: "agent" });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      await expect(guard.canActivate(ctx(method, { [VIEW_AS_HEADER]: TARGET }, "open").context)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("refuses an admin viewing as an owner or another admin, and a non-manager viewing as anyone", async () => {
    for (const [actorRole, targetRole] of [["admin", "owner"], ["admin", "admin"], ["agent", "viewer"], ["viewer", "viewer"]] as const) {
      const { guard, ctx } = setup({ [ACTOR]: actorRole, [TARGET]: targetRole });
      await expect(guard.canActivate(ctx("GET", { [VIEW_AS_HEADER]: TARGET }, "open").context)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("refuses viewing as oneself, as a non-member, and with a malformed id", async () => {
    const { guard, ctx } = setup({ [ACTOR]: "owner" });
    await expect(guard.canActivate(ctx("GET", { [VIEW_AS_HEADER]: ACTOR }, "open").context)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(guard.canActivate(ctx("GET", { [VIEW_AS_HEADER]: TARGET }, "open").context)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(guard.canActivate(ctx("GET", { [VIEW_AS_HEADER]: "not-a-uuid" }, "open").context)).rejects.toBeInstanceOf(ValidationError);
  });

  it("leaves normal requests untouched when the header is absent", async () => {
    const { guard, ctx } = setup({ [ACTOR]: "admin" });
    const { req, context } = ctx("GET", {}, "managersOnly");
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.tenant).toEqual({ id: TENANT, role: "admin" });
    expect(req.viewAs).toBeUndefined();
    expect(req.tenantDb?.userId).toBe(ACTOR);
  });
});
