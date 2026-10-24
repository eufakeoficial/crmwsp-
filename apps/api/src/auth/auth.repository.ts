import { Inject, Injectable } from "@nestjs/common";
import type { MembershipRole, TenantStatus } from "@crmwsp/contracts";
import { auditEvents, withTenant } from "@crmwsp/db";
import { DB_HANDLE, type DbHandle } from "../common/http.js";

export interface LoginRow {
  userId: string;
  passwordHash: string;
}
export interface SessionUserRow {
  id: string;
  email: string;
  name: string | null;
}
export interface UserTenantRow {
  id: string;
  slug: string;
  name: string;
  role: MembershipRole;
  status: TenantStatus;
}

/**
 * The ONLY path that runs without a tenant context: it calls the SECURITY
 * DEFINER functions of migration 0006. The app role cannot read
 * user_credentials/sessions directly.
 */
@Injectable()
export class AuthRepository {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async findLogin(email: string): Promise<LoginRow | undefined> {
    const rows = await this.handle.sql<{ user_id: string; password_hash: string }[]>`
      select user_id, password_hash from public.auth_login(${email})`;
    const r = rows[0];
    return r ? { userId: r.user_id, passwordHash: r.password_hash } : undefined;
  }

  async signupTenant(input: {
    email: string;
    name: string;
    passwordHash: string;
    tenantName: string;
    tenantSlug: string;
  }): Promise<{ userId: string; tenantId: string }> {
    const rows = await this.handle.sql<{ user_id: string; tenant_id: string }[]>`
      select user_id, tenant_id from public.signup_tenant(
        ${input.email}, ${input.name}, ${input.passwordHash}, ${input.tenantName}, ${input.tenantSlug})`;
    const r = rows[0];
    if (!r) throw new Error("signup_tenant returned no row");
    return { userId: r.user_id, tenantId: r.tenant_id };
  }

  /** `tenant_signup_signals_record` (0069): signup IP + normalized email of a new tenant. */
  async recordSignupSignals(tenantId: string, ip: string | null, emailNormalized: string | null): Promise<void> {
    await this.handle.sql`select public.tenant_signup_signals_record(${tenantId}::uuid, ${ip}::inet, ${emailNormalized})`;
  }

  /** `tenant_referral_record` (0072): who referred a new tenant; unknown/self codes are ignored. */
  async recordReferral(tenantId: string, code: string): Promise<void> {
    await this.handle.sql`select public.tenant_referral_record(${tenantId}::uuid, ${code})`;
  }

  /** `password_reset_request` (0074): no row for unknown emails / accounts without a password. */
  async requestPasswordReset(
    email: string,
    tokenHash: Buffer,
    ttlSeconds: number,
    ip: string | null,
  ): Promise<{ userId: string; email: string; name: string | null } | undefined> {
    const rows = await this.handle.sql<{ user_id: string; email: string; name: string | null }[]>`
      select user_id, email, name from public.password_reset_request(${email}, ${tokenHash}, ${ttlSeconds}, ${ip && ip !== "unknown" ? ip : null})`;
    const r = rows[0];
    return r ? { userId: r.user_id, email: r.email, name: r.name } : undefined;
  }

  /** `password_reset_consume` (0074): sets the password and revokes all sessions; undefined if invalid. */
  async consumePasswordReset(tokenHash: Buffer, passwordHash: string): Promise<string | undefined> {
    const rows = await this.handle.sql<{ user_id: string | null }[]>`
      select public.password_reset_consume(${tokenHash}, ${passwordHash}) as user_id`;
    return rows[0]?.user_id ?? undefined;
  }

  async createSession(input: {
    userId: string;
    tokenHash: Buffer;
    ip: string | null;
    userAgent: string | null;
    ttlSeconds: number;
  }): Promise<void> {
    await this.handle.sql`
      select * from public.create_session(
        ${input.userId}, ${input.tokenHash}, ${input.ip}, ${input.userAgent}, ${input.ttlSeconds})`;
  }

  async resolveSession(
    tokenHash: Buffer,
    ttlSeconds: number,
  ): Promise<{ user: SessionUserRow; expiresAt: Date } | undefined> {
    const rows = await this.handle.sql<{ user_id: string; email: string; name: string | null; expires_at: Date }[]>`
      select user_id, email, name, expires_at from public.resolve_session(${tokenHash}, ${ttlSeconds})`;
    const r = rows[0];
    return r ? { user: { id: r.user_id, email: r.email, name: r.name }, expiresAt: new Date(r.expires_at) } : undefined;
  }

  async revokeSession(tokenHash: Buffer): Promise<void> {
    await this.handle.sql`select public.revoke_session(${tokenHash})`;
  }

  async listUserTenants(userId: string): Promise<UserTenantRow[]> {
    const rows = await this.handle.sql<{ tenant_id: string; slug: string; name: string; role: MembershipRole; status: TenantStatus }[]>`
      select tenant_id, slug, name, role, status from public.list_user_tenants(${userId})`;
    return rows.map((r) => ({ id: r.tenant_id, slug: r.slug, name: r.name, role: r.role, status: r.status }));
  }

  /**
   * Auth audit rows. audit_events is tenant-scoped, so an event about a user is appended to every
   * tenant that user belongs to (each tenant's owners see attempts on their members).
   */
  async writeAuthAudit(
    tenantIds: readonly string[],
    e: { action: string; userId: string | null; diff: Record<string, unknown>; ip: string | null },
  ): Promise<void> {
    for (const tenantId of tenantIds) {
      await withTenant(this.handle.db, tenantId, async (tx) => {
        await tx.insert(auditEvents).values({
          tenantId,
          actorType: e.userId ? "user" : "system",
          actorId: e.userId,
          entity: "auth",
          entityId: e.userId,
          action: e.action,
          diff: e.diff,
          ip: e.ip && e.ip !== "unknown" ? e.ip : null,
        });
      });
    }
  }
}
