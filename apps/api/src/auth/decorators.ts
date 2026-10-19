import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { TenantContextMissingError, UnauthorizedError, type MembershipRole } from "@crmwsp/contracts";
import type { HttpRequest, RequestTenant, RequestUser } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";

export const ROLES_KEY = "crmwsp:roles";
export const PUBLIC_KEY = "crmwsp:public";

export interface PublicOptions {
  /** Also enforce the Origin/Fetch-Metadata CSRF check (browser-facing forms like login). */
  sameOrigin?: boolean;
}

/**
 * Opts a route (or controller) out of the global SessionGuard. Use for
 * signup/login/logout, health and provider webhooks (WebhooksController must
 * be decorated with @Public()). Everything else requires a valid session.
 */
export const Public = (options: PublicOptions = {}) => SetMetadata(PUBLIC_KEY, options);

/** Restricts a tenant-scoped handler to these membership roles (checked by TenantGuard). */
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);

const req = (ctx: ExecutionContext): HttpRequest => ctx.switchToHttp().getRequest<HttpRequest>();

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  const user = req(ctx).user;
  if (!user) throw new UnauthorizedError();
  return user;
});

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestTenant => {
  const tenant = req(ctx).tenant;
  if (!tenant) throw new TenantContextMissingError();
  return tenant;
});

/** Tenant-bound DB access; only available behind TenantGuard. */
export const CurrentTenantDb = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantDb => {
  const db = req(ctx).tenantDb;
  if (!db) throw new TenantContextMissingError();
  return db;
});
