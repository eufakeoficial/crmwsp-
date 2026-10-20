import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingController } from "./billing.controller.js";
import { PlanLimitsService } from "./plan-limits.service.js";

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class BillingModule {}
