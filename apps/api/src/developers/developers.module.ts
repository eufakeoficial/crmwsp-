import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ChannelsModule } from "../channels/channels.module.js";
import { ApiKeyGuard } from "./api-key.guard.js";
import { DevelopersController } from "./developers.controller.js";
import { PublicApiController } from "./public-api.controller.js";

/** Tenant API keys, public REST API v1 and outbound webhook endpoints (delivered by the worker). */
@Module({
  imports: [AuthModule, ChannelsModule],
  controllers: [DevelopersController, PublicApiController],
  providers: [ApiKeyGuard],
})
export class DevelopersModule {}
