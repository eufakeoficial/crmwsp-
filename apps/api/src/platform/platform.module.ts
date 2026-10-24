import { Module } from "@nestjs/common";
import { createMailerFromEnv, resendReceivingFromEnv } from "@crmwsp/mailer";
import { AuthModule } from "../auth/auth.module.js";
import { EventsModule } from "../events/events.module.js";
import { DEFAULT_PLATFORM_RATE_LIMIT, PLATFORM_RATE_LIMIT, PlatformAdminGuard } from "./platform-admin.guard.js";
import { PlatformEmailController } from "./platform-email.controller.js";
import { PlatformEmailRepository } from "./platform-email.repository.js";
import { PLATFORM_EMAIL_MAILER, PLATFORM_EMAIL_RESEND, PlatformEmailService } from "./platform-email.service.js";
import { PlatformSupportController } from "./platform-support.controller.js";
import { PlatformSupportRepository } from "./platform-support.repository.js";
import { PlatformController, PlatformMeController } from "./platform.controller.js";
import { PlatformCouponsController, PlatformCouponsService } from "./platform-coupons.js";
import { NOWPAYMENTS_BALANCE_CLIENT, PlatformFinanceController, PlatformFinanceService, balanceClientFromEnv } from "./platform-finance.js";
import { PlatformRepository } from "./platform.repository.js";
import { PLATFORM_MAILER, PlatformService } from "./platform.service.js";

@Module({
  imports: [AuthModule, EventsModule],
  // PlatformMeController first: `GET /platform/me` must not hit the admin guard.
  controllers: [
    PlatformMeController,
    PlatformController,
    PlatformCouponsController,
    PlatformFinanceController,
    PlatformSupportController,
    PlatformEmailController,
  ],
  providers: [
    PlatformRepository,
    PlatformSupportRepository,
    PlatformEmailRepository,
    PlatformEmailService,
    { provide: PLATFORM_EMAIL_MAILER, useFactory: () => createMailerFromEnv() },
    { provide: PLATFORM_EMAIL_RESEND, useFactory: () => resendReceivingFromEnv() },
    PlatformService,
    PlatformCouponsService,
    PlatformFinanceService,
    { provide: NOWPAYMENTS_BALANCE_CLIENT, useFactory: balanceClientFromEnv },
    PlatformAdminGuard,
    { provide: PLATFORM_MAILER, useFactory: () => createMailerFromEnv() },
    { provide: PLATFORM_RATE_LIMIT, useValue: DEFAULT_PLATFORM_RATE_LIMIT },
  ],
})
export class PlatformModule {}
