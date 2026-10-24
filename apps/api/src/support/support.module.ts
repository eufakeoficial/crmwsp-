import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EventsModule } from "../events/events.module.js";
import { DEFAULT_SUPPORT_CREATE_RATE_LIMIT, SUPPORT_CREATE_RATE_LIMIT, SupportController } from "./support.controller.js";

/** Tenant side of support tickets. The backoffice side lives in PlatformModule. */
@Module({
  imports: [AuthModule, EventsModule],
  controllers: [SupportController],
  providers: [{ provide: SUPPORT_CREATE_RATE_LIMIT, useValue: DEFAULT_SUPPORT_CREATE_RATE_LIMIT }],
})
export class SupportModule {}
