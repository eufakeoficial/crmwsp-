import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import type { BillingPlanResponse } from "@crmwsp/contracts";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PlanLimitsService } from "./plan-limits.service.js";

@Controller("billing")
// SessionGuard is global (APP_GUARD) and runs first.
@UseGuards(TenantGuard)
export class BillingController {
  constructor(@Inject(PlanLimitsService) private readonly limits: PlanLimitsService) {}

  /**
   * GET /billing/plan — current plan and usage of the tenant (response: `billingPlanResponseSchema`
   * in @crmwsp/contracts). Read-only; plans are not purchasable here (no billing provider yet).
   */
  @Get("plan")
  @Roles("owner", "admin")
  plan(@CurrentTenantDb() db: TenantDb): Promise<BillingPlanResponse> {
    return db.run((tx) => this.limits.snapshot(tx));
  }
}
