import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  type AcceptInvitationResponse,
  acceptInvitationRequestSchema,
  createInvitationRequestSchema,
  type InvitationPreview,
  invitationTokenSchema,
  type TeamInvitation,
  type TeamInvitationList,
  UnauthorizedError,
  updateMemberRoleRequestSchema,
  uuidSchema,
} from "@crmwsp/contracts";
import { AuthService } from "../auth/auth.service.js";
import { CurrentTenant, CurrentTenantDb, CurrentUser, Public, Roles } from "../auth/decorators.js";
import { readSessionToken, setSessionCookie } from "../auth/session-token.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { type HttpReply, type HttpRequest, type RequestTenant, type RequestUser, headerValue } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { InvitationAcceptService } from "./invitation-accept.service.js";
import { type Actor, TeamService } from "./team.service.js";

const actorOf = (user: RequestUser, tenant: RequestTenant, req: HttpRequest): Actor => ({ userId: user.id, role: tenant.role, ip: req.ip });
const clientInfo = (req: HttpRequest) => ({ ip: req.ip || null, userAgent: headerValue(req, "user-agent") ?? null });

@Controller("team")
@UseGuards(TenantGuard)
@Roles("owner", "admin")
export class TeamController {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  @Get("invitations")
  async list(@CurrentTenantDb() db: TenantDb): Promise<TeamInvitationList> {
    return { items: await this.team.listInvitations(db) };
  }

  @Post("invitations")
  @HttpCode(201)
  invite(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: HttpRequest,
    @Body() body: unknown,
  ): Promise<TeamInvitation> {
    return this.team.invite(db, actorOf(user, tenant, req), parseOrThrow(createInvitationRequestSchema, body));
  }

  @Post("invitations/:id/resend")
  @HttpCode(200)
  resend(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: HttpRequest,
    @Param("id") id: string,
  ): Promise<TeamInvitation> {
    return this.team.resend(db, actorOf(user, tenant, req), parseOrThrow(uuidSchema, id));
  }

  @Delete("invitations/:id")
  @HttpCode(204)
  revoke(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: HttpRequest,
    @Param("id") id: string,
  ): Promise<void> {
    return this.team.revoke(db, actorOf(user, tenant, req), parseOrThrow(uuidSchema, id));
  }

  @Patch("members/:userId")
  @HttpCode(204)
  changeRole(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: HttpRequest,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const { role } = parseOrThrow(updateMemberRoleRequestSchema, body);
    return this.team.changeRole(db, actorOf(user, tenant, req), parseOrThrow(uuidSchema, userId), role);
  }

  @Delete("members/:userId")
  @HttpCode(204)
  remove(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Req() req: HttpRequest,
    @Param("userId") userId: string,
  ): Promise<void> {
    return this.team.removeMember(db, actorOf(user, tenant, req), parseOrThrow(uuidSchema, userId));
  }
}

/** Public invitation routes (the token is the credential). Rate-limited per IP. */
@Controller("invitations")
export class InvitationsController {
  constructor(
    @Inject(InvitationAcceptService) private readonly accept: InvitationAcceptService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get(":token")
  @Public()
  preview(@Param("token") token: string, @Req() req: HttpRequest): Promise<InvitationPreview> {
    return this.accept.preview(parseOrThrow(invitationTokenSchema, token), clientInfo(req));
  }

  /**
   * With a valid session: accepts for that user (their email must be the invited one).
   * Without: `{ name, password }` creates the account for the invited email and signs in.
   */
  @Post(":token/accept")
  @Public({ sameOrigin: true })
  @HttpCode(200)
  async acceptInvitation(
    @Param("token") rawToken: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) reply: HttpReply,
  ): Promise<AcceptInvitationResponse> {
    const token = parseOrThrow(invitationTokenSchema, rawToken);
    const input = parseOrThrow(acceptInvitationRequestSchema, body ?? {});
    const session = readSessionToken(req);
    const user = session ? await this.auth.resolve(session) : undefined;
    if (user) return this.accept.acceptAsUser(token, user.id, clientInfo(req));
    if (!("password" in input) || !("name" in input)) throw new UnauthorizedError("Log in to accept this invitation");
    const res = await this.accept.acceptWithSignup(token, { name: input.name, password: input.password }, clientInfo(req));
    setSessionCookie(reply, res.sessionToken, this.auth.ttlSeconds);
    return { tenantId: res.tenantId, role: res.role };
  }
}
