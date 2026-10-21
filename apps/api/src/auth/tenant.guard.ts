import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ForbiddenError,
  type MembershipRole,
  TENANT_HEADER,
  UnauthorizedError,
  ValidationError,
  tenantIdSchema,
} from "@crmwsp/contracts";
import { DB_HANDLE, type DbHandle, type HttpRequest, headerValue } from "../common/http.js";
import { TenantDb } from "../db/tenant-db.js";
import { AuthService } from "./auth.service.js";
import { ROLES_KEY } from "./decorators.js";

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);
const DEFAULT_WRITE_ROLES: readonly MembershipRole[] = ["owner", "admin", "agent"];

/**
 * Must run after SessionGuard. Reads x-tenant-id, checks the user's
 * membership (and @Roles) and that the tenant is active, then sets
 * request.tenant and request.tenantDb.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<HttpRequest>();
    if (!req.user) throw new UnauthorizedError();
    const parsed = tenantIdSchema.safeParse(headerValue(req, TENANT_HEADER));
    if (!parsed.success) throw new ValidationError(`Missing or invalid ${TENANT_HEADER} header`);
    const membership = (await this.auth.listTenants(req.user.id)).find((t) => t.id === parsed.data);
    if (!membership) throw new ForbiddenError();
    // Pending, rejected or suspended tenants can log in but cannot use the panel API (ADR 0011).
    if (membership.status !== "active") {
      throw new ForbiddenError("Tenant is not active", { details: { reason: "tenant_not_active", status: membership.status } });
    }
    const roles = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Deny by default for writes: a non-GET/HEAD route without @Roles excludes viewers.
    // Routes that viewers may legitimately call must opt in with an explicit @Roles(..., "viewer").
    const effective = roles && roles.length > 0 ? roles : READ_METHODS.has(req.method ?? "") ? undefined : DEFAULT_WRITE_ROLES;
    if (effective && !effective.includes(membership.role)) throw new ForbiddenError();
    req.tenant = { id: membership.id, role: membership.role };
    req.tenantDb = new TenantDb(this.handle.db, membership.id, req.user.id);
    return true;
  }
}
