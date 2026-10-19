import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module.js";
import { AppErrorFilter } from "./common/error.filter.js";
import { DbModule } from "./db/db.module.js";
import { HealthController } from "./health.controller.js";
import { TenantModule } from "./tenant/tenant.module.js";
import { WebhooksModule } from "./webhooks/webhooks.module.js";

@Module({
  imports: [DbModule, AuthModule, TenantModule, WebhooksModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: AppErrorFilter }],
})
export class AppModule {}
