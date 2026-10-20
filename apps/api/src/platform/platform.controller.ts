import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import {
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

  @Get("settings")
  settings(@CurrentUser() user: RequestUser, @Req() req: HttpRequest): Promise<PlatformSettings> {
    return this.platform.settings(actorOf(user, req));
  }

  @Patch("settings")
  updateSettings(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Body() body: unknown): Promise<PlatformSettings> {
    return this.platform.updateSettings(actorOf(user, req), parseOrThrow(updatePlatformSettingsRequestSchema, body).requireApproval);
  }
}
