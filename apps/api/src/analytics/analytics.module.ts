import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AnalyticsController } from "./analytics.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
