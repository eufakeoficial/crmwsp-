import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ForbiddenError,
  type MembershipRole,
  TENANT_HEADER,
  UnauthorizedError,
  VIEW_AS_HEADER,
  ValidationError,
  tenantIdSchema,
  uuidSchema,
} from "@crmwsp/contracts";
import { canViewAs } from "@crmwsp/domain";
import { writeAudit } from "../inbox/audit.js";
import { DB_HANDLE, type DbHandle, type HttpRequest, headerValue } from "../common/http.js";
import { TenantDb } from "../db/tenant-db.js";
import { AuthService } from "./auth.service.js";
import { ROLES_KEY } from "./decorators.js";

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);
/** One audit row per actor+target while they keep viewing (a view is many GETs). */
const VIEW_AS_AUDIT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_WRITE_ROLES: readonly MembershipRole[] = ["owner", "admin", "agent"];

/**
 * Must run after SessionGuard. Reads x-tenant-id, checks the user's
 * membership (and @Roles) and that the tenant is active, then sets
 * request.tenant and request.tenantDb.
 *
 * Read-only "view as": an owner/admin may send x-view-as-user with a lower-ranked member's id. The
 * request is then answered with that member's role and user id (so inbox visibility, menus and
 * @Roles behave exactly as they do for them), but only for GET/HEAD: any write is refused.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly viewAsAudited = new Map<string, number>();

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
    let role = membership.role;
    let userId = req.user.id;
    const viewAsRaw = headerValue(req, VIEW_AS_HEADER);
    if (viewAsRaw !== undefined) {
      if (!READ_METHODS.has(req.method ?? "")) {
        throw new ForbiddenError("View-as is read-only", { details: { reason: "view_as_read_only" } });
      }
      const target = uuidSchema.safeParse(viewAsRaw);
      if (!target.success) throw new ValidationError(`Invalid ${VIEW_AS_HEADER} header`);
      const targetMembership = (await this.auth.listTenants(target.data)).find((t) => t.id === parsed.data);
      if (!targetMembership) throw new ForbiddenError();
      const decision = canViewAs({ actor: membership.role, target: targetMembership.role, sameUser: target.data === req.user.id });
      if (!decision.allowed) throw new ForbiddenError("Cannot view as this member", { details: { reason: decision.reason } });
      role = targetMembership.role;
      userId = target.data;
      req.viewAs = { actorUserId: req.user.id, targetUserId: target.data };
      await this.auditViewAs(req, membership.id, targetMembership.role);
    }
    const roles = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Deny by default for writes: a non-GET/HEAD route without @Roles excludes viewers.
    // Routes that viewers may legitimately call must opt in with an explicit @Roles(..., "viewer").
    const effective = roles && roles.length > 0 ? roles : READ_METHODS.has(req.method ?? "") ? undefined : DEFAULT_WRITE_ROLES;
    if (effective && !effective.includes(role)) throw new ForbiddenError();
    req.tenant = { id: membership.id, role };
    req.tenantDb = new TenantDb(this.handle.db, membership.id, userId);
    return true;
  }

  /**
   * Audits a view-as so it cannot be used without leaving a trace, even when the start endpoint was
   * never called. Deduplicated per actor+target; if the audit cannot be written the request fails.
   */
  private async auditViewAs(req: HttpRequest, tenantId: string, targetRole: MembershipRole): Promise<void> {
    const viewAs = req.viewAs;
    if (!viewAs) return;
    const key = `${tenantId}:${viewAs.actorUserId}:${viewAs.targetUserId}`;
    const now = Date.now();
    const last = this.viewAsAudited.get(key);
    if (last !== undefined && now - last < VIEW_AS_AUDIT_WINDOW_MS) return;
    await this.recordViewAs(req, tenantId, targetRole);
    if (this.viewAsAudited.size > 1000) this.viewAsAudited.clear();
    this.viewAsAudited.set(key, now);
  }

  protected async recordViewAs(req: HttpRequest, tenantId: string, targetRole: MembershipRole): Promise<void> {
    const viewAs = req.viewAs;
    if (!viewAs) return;
    // The audit row belongs to the real actor, never to the member being viewed.
    await new TenantDb(this.handle.db, tenantId, viewAs.actorUserId).run((tx) =>
      writeAudit(tx, {
        tenantId,
        userId: viewAs.actorUserId,
        entity: "membership",
        entityId: viewAs.targetUserId,
        action: "membership.view_as_request",
        diff: { userId: viewAs.targetUserId, role: targetRole },
        ip: req.ip,
      }),
    );
  }
}
