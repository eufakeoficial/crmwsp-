import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import {
  createSubscriptionChargeRequestSchema,
  uuidSchema,
  type BillingPlanResponse,
  type SubscriptionChargeDto,
  type SubscriptionChargeList,
} from "@crmwsp/contracts";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PlanLimitsService } from "./plan-limits.service.js";
import { SubscriptionService } from "./subscription.service.js";

@Controller("billing")
// SessionGuard is global (APP_GUARD) and runs first.
@UseGuards(TenantGuard)
export class BillingController {
  constructor(
    @Inject(PlanLimitsService) private readonly limits: PlanLimitsService,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * GET /billing/plan — current plan, usage and subscription access of the tenant (response:
   * `billingPlanResponseSchema` in @crmwsp/contracts).
   */
  @Get("plan")
  @Roles("owner", "admin")
  plan(@CurrentTenantDb() db: TenantDb): Promise<BillingPlanResponse> {
    return db.run((tx) => this.limits.snapshot(tx));
  }

  /**
   * POST /billing/subscription/charges — NOWPayments crypto invoice for one period of a plan
   * (ADR 0013): `period` monthly (30 days, default) or annual (365 days, ADR 0015). Returns the deposit address, amount and QR data; the charge becomes `paid`
   * only after a verified IPN or reconciliation.
   */
  @Post("subscription/charges")
  @HttpCode(201)
  @Roles("owner", "admin")
  createCharge(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<SubscriptionChargeDto> {
    const input = parseOrThrow(createSubscriptionChargeRequestSchema, body);
    return this.subscriptions.createCharge(db, input.plan, input.period);
  }

  /** GET /billing/subscription/charges — latest 50 charges of the tenant. */
  @Get("subscription/charges")
  @Roles("owner", "admin")
  charges(@CurrentTenantDb() db: TenantDb): Promise<SubscriptionChargeList> {
    return this.subscriptions.listCharges(db);
  }

  /** GET /billing/subscription/charges/:id — status polling. */
  @Get("subscription/charges/:id")
  @Roles("owner", "admin")
  charge(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<SubscriptionChargeDto> {
    return this.subscriptions.getCharge(db, parseOrThrow(uuidSchema, id));
  }
}
