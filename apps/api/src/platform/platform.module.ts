import { Module } from "@nestjs/common";
import { createMailerFromEnv } from "@crmwsp/mailer";
import { AuthModule } from "../auth/auth.module.js";
import { DEFAULT_PLATFORM_RATE_LIMIT, PLATFORM_RATE_LIMIT, PlatformAdminGuard } from "./platform-admin.guard.js";
import { PlatformController, PlatformMeController } from "./platform.controller.js";
import { PlatformCouponsController, PlatformCouponsService } from "./platform-coupons.js";
import { NOWPAYMENTS_BALANCE_CLIENT, PlatformFinanceController, PlatformFinanceService, balanceClientFromEnv } from "./platform-finance.js";
import { PlatformRepository } from "./platform.repository.js";
import { PlatformPoliciesController, PlatformPoliciesService } from "./platform-policies.js";
import { PLATFORM_MAILER, PlatformService } from "./platform.service.js";

@Module({
  imports: [AuthModule],
  // PlatformMeController first: `GET /platform/me` must not hit the admin guard.
  controllers: [PlatformMeController, PlatformController, PlatformCouponsController, PlatformFinanceController, PlatformPoliciesController],
  providers: [
    PlatformRepository,
    PlatformService,
    PlatformCouponsService,
    PlatformFinanceService,
    PlatformPoliciesService,
    { provide: NOWPAYMENTS_BALANCE_CLIENT, useFactory: balanceClientFromEnv },
    PlatformAdminGuard,
    { provide: PLATFORM_MAILER, useFactory: () => createMailerFromEnv() },
    { provide: PLATFORM_RATE_LIMIT, useValue: DEFAULT_PLATFORM_RATE_LIMIT },
  ],
})
export class PlatformModule {}
