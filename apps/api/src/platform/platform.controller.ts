import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import {
  type PlatformAuditPage,
  type PlatformChannelList,
  type PlatformPlans,
  type PlatformUsage,
  type PlatformUser,
  type PlatformUserList,
  type RevokeSessionsResponse,
  platformAuditQuerySchema,
  platformChannelListQuerySchema,
  platformUsageQuerySchema,
  platformUserListQuerySchema,
  type PlatformDashboard,
  type PlatformMeResponse,
  type PlatformSettings,
  type PlatformTenant,
  type PlatformTenantDetail,
  type PlatformTenantList,
  type SubscriptionPayment,
  type SubscriptionPaymentList,
  platformTenantListQuerySchema,
  recordSubscriptionPaymentRequestSchema,
  subscriptionPaymentListQuerySchema,
  tenantPlanChangeRequestSchema,
  tenantStatusChangeRequestSchema,
  updatePlatformSettingsRequestSchema,
  uuidSchema,
} from "@crmwsp/contracts";
import { CurrentUser } from "../auth/decorators.js";
import type { HttpRequest, RequestUser } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import { PlatformAdminGuard } from "./platform-admin.guard.js";
import { type PlatformActor, PlatformService } from "./platform.service.js";

const actorOf = (user: RequestUser, req: HttpRequest): PlatformActor => ({ userId: user.id, ip: req.ip || null });

/** Open to any session: tells the web whether to show the "Admin" entry. */
@Controller("platform")
export class PlatformMeController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get("me")
  async me(@CurrentUser() user: RequestUser): Promise<PlatformMeResponse> {
    return { isPlatformAdmin: await this.platform.isAdmin(user.id) };
  }
}

/** SaaS backoffice (ADR 0011). Non-admins get 404 from PlatformAdminGuard. */
@Controller("platform")
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get("dashboard")
  dashboard(@CurrentUser() user: RequestUser, @Req() req: HttpRequest): Promise<PlatformDashboard> {
    return this.platform.dashboard(actorOf(user, req));
  }

  @Get("tenants")
  async tenants(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Query() query: unknown): Promise<PlatformTenantList> {
    return { items: await this.platform.listTenants(actorOf(user, req), parseOrThrow(platformTenantListQuerySchema, query)) };
  }

  @Get("tenants/:id")
  tenant(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string): Promise<PlatformTenantDetail> {
    return this.platform.tenantDetail(actorOf(user, req), parseOrThrow(uuidSchema, id));
  }

  @Post("tenants/:id/status")
  @HttpCode(200)
  status(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown): Promise<PlatformTenant> {
    return this.platform.changeStatus(actorOf(user, req), parseOrThrow(uuidSchema, id), parseOrThrow(tenantStatusChangeRequestSchema, body));
  }

  @Put("tenants/:id/plan")
  plan(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown): Promise<PlatformTenant> {
    return this.platform.changePlan(actorOf(user, req), parseOrThrow(uuidSchema, id), parseOrThrow(tenantPlanChangeRequestSchema, body));
  }

  @Get("payments")
  payments(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Query() query: unknown): Promise<SubscriptionPaymentList> {
    return this.platform.listPayments(actorOf(user, req), parseOrThrow(subscriptionPaymentListQuerySchema, query));
  }

  @Post("payments")
  @HttpCode(201)
  recordPayment(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Body() body: unknown): Promise<SubscriptionPayment> {
    return this.platform.recordPayment(actorOf(user, req), parseOrThrow(recordSubscriptionPaymentRequestSchema, body));
  }

  @Get("users")
  async users(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Query() query: unknown): Promise<PlatformUserList> {
    return { items: await this.platform.listUsers(actorOf(user, req), parseOrThrow(platformUserListQuerySchema, query)) };
  }

  @Get("users/:id")
  userDetail(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string): Promise<PlatformUser> {
    return this.platform.user(actorOf(user, req), parseOrThrow(uuidSchema, id));
  }

  @Post("users/:id/revoke-sessions")
  @HttpCode(200)
  revokeSessions(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string): Promise<RevokeSessionsResponse> {
    return this.platform.revokeSessions(actorOf(user, req), parseOrThrow(uuidSchema, id));
  }

  @Get("channels")
  async channels(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Query() query: unknown): Promise<PlatformChannelList> {
    return { items: await this.platform.listChannels(actorOf(user, req), parseOrThrow(platformChannelListQuerySchema, query)) };
  }

  @Get("plans")
  plans(@CurrentUser() user: RequestUser, @Req() req: HttpRequest): Promise<PlatformPlans> {
    return this.platform.plans(actorOf(user, req));
  }

  @Get("usage")
  usage(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Query() query: unknown): Promise<PlatformUsage> {
    return this.platform.usage(actorOf(user, req), parseOrThrow(platformUsageQuerySchema, query));
  }

  @Get("audit")
  audit(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Query() query: unknown): Promise<PlatformAuditPage> {
    return this.platform.audit(actorOf(user, req), parseOrThrow(platformAuditQuerySchema, query));
  }

  @Get("settings")
  settings(@CurrentUser() user: RequestUser, @Req() req: HttpRequest): Promise<PlatformSettings> {
    return this.platform.settings(actorOf(user, req));
  }

  @Patch("settings")
  updateSettings(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Body() body: unknown): Promise<PlatformSettings> {
    return this.platform.updateSettings(actorOf(user, req), parseOrThrow(updatePlatformSettingsRequestSchema, body).requireApproval);
  }
}
