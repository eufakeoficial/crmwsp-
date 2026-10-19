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

/**
 * Must run after SessionGuard. Reads x-tenant-id, checks the user's
 * membership (and @Roles), then sets request.tenant and request.tenantDb.
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
    const roles = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && roles.length > 0 && !roles.includes(membership.role)) throw new ForbiddenError();
    req.tenant = { id: membership.id, role: membership.role };
    req.tenantDb = new TenantDb(this.handle.db, membership.id, req.user.id);
    return true;
  }
}
