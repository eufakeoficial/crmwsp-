import { Module } from "@nestjs/common";
import { createMailerFromEnv } from "@crmwsp/mailer";
import { AuthModule } from "../auth/auth.module.js";
import { DEFAULT_PLATFORM_RATE_LIMIT, PLATFORM_RATE_LIMIT, PlatformAdminGuard } from "./platform-admin.guard.js";
import { PlatformController, PlatformMeController } from "./platform.controller.js";
import { PlatformRepository } from "./platform.repository.js";
import { PLATFORM_MAILER, PlatformService } from "./platform.service.js";

@Module({
  imports: [AuthModule],
  // PlatformMeController first: `GET /platform/me` must not hit the admin guard.
  controllers: [PlatformMeController, PlatformController],
  providers: [
    PlatformRepository,
    PlatformService,
    PlatformAdminGuard,
    { provide: PLATFORM_MAILER, useFactory: () => createMailerFromEnv() },
    { provide: PLATFORM_RATE_LIMIT, useValue: DEFAULT_PLATFORM_RATE_LIMIT },
  ],
})
export class PlatformModule {}
