import { Inject, Injectable } from "@nestjs/common";
import {
  type AcceptInvitationResponse,
  ConflictError,
  ForbiddenError,
  type InvitableRole,
  type InvitationPreview,
  NotFoundError,
  type TenantId,
  UnauthorizedError,
  ValidationError,
} from "@crmwsp/contracts";
import { DB_HANDLE, type DbHandle } from "../common/http.js";
import { pgCode } from "../inbox/audit.js";
import { AuthService, type ClientInfo } from "../auth/auth.service.js";
import { hashPassword } from "../auth/password.js";
import { InMemoryRateLimiter, type RateLimitOptions } from "../auth/rate-limiter.js";
import { hashInvitationToken } from "./invitation-token.js";

export const INVITE_RATE_LIMIT = Symbol("INVITE_RATE_LIMIT");
/** Per IP on the public invitation routes (lookup + accept). */
export const DEFAULT_INVITE_RATE_LIMIT: RateLimitOptions = { limit: 30, windowMs: 15 * 60 * 1000 };

const INVALID = "Invitation not found or expired";

function mapError(err: unknown): never {
  switch (pgCode(err)) {
    case "P0002":
      throw new NotFoundError(INVALID);
    case "42501":
      throw new ForbiddenError("This invitation was sent to a different email");
    case "23505":
      throw new ConflictError("Invitation could not be accepted");
    case "22023":
      throw new ValidationError("Invalid input");
    default:
      throw err;
  }
}

/**
 * Public accept flow. Runs without a tenant context only through the SECURITY DEFINER functions
 * of migration 0050 (lookup returns a minimal row; accept/signup are single use and row-locked).
 */
@Injectable()
export class InvitationAcceptService {
  private readonly limiter: InMemoryRateLimiter;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(INVITE_RATE_LIMIT) rateLimit: RateLimitOptions,
  ) {
    this.limiter = new InMemoryRateLimiter(rateLimit);
  }

  async preview(token: string, client: ClientInfo): Promise<InvitationPreview> {
    this.limiter.consume(`invite:${client.ip ?? "-"}`);
    const rows = await this.handle.sql<
      { tenant_name: string; email: string; role: InvitableRole; expires_at: Date; has_account: boolean }[]
    >`select tenant_name, email, role, expires_at, has_account from public.team_invitation_lookup(${hashInvitationToken(token)})`;
    const r = rows[0];
    if (!r) throw new NotFoundError(INVALID);
    return { tenantName: r.tenant_name, email: r.email, role: r.role, expiresAt: new Date(r.expires_at).toISOString(), hasAccount: r.has_account };
  }

  /** Signed-in user: adds the membership if the session's email is the invited one. */
  async acceptAsUser(token: string, userId: string, client: ClientInfo): Promise<AcceptInvitationResponse> {
    this.limiter.consume(`invite:${client.ip ?? "-"}`);
    try {
      const rows = await this.handle.sql<{ tenant_id: string; role: InvitableRole }[]>`
        select tenant_id, role from public.team_invitation_accept(${hashInvitationToken(token)}, ${userId})`;
      const r = rows[0];
      if (!r) throw new NotFoundError(INVALID);
      return { tenantId: r.tenant_id as TenantId, role: r.role };
    } catch (err) {
      mapError(err);
    }
  }

  /** New account with the invited email (never a caller-chosen one) + membership + session. */
  async acceptWithSignup(
    token: string,
    input: { name: string; password: string },
    client: ClientInfo,
  ): Promise<AcceptInvitationResponse & { sessionToken: string; userId: string }> {
    this.limiter.consume(`invite:${client.ip ?? "-"}`);
    const passwordHash = await hashPassword(input.password);
    let row: { user_id: string; tenant_id: string; role: InvitableRole } | undefined;
    try {
      [row] = await this.handle.sql<{ user_id: string; tenant_id: string; role: InvitableRole }[]>`
        select user_id, tenant_id, role from public.team_invitation_signup(${hashInvitationToken(token)}, ${input.name}, ${passwordHash})`;
    } catch (err) {
      // 23505 here = the email already has an account: the client must log in and accept.
      if (pgCode(err) === "23505") throw new UnauthorizedError("Log in to accept this invitation");
      mapError(err);
    }
    if (!row) throw new NotFoundError(INVALID);
    const sessionToken = await this.auth.openSessionFor(row.user_id, client);
    return { tenantId: row.tenant_id as TenantId, role: row.role, sessionToken, userId: row.user_id };
  }
}
