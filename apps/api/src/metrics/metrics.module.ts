import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MetricsController } from "./metrics.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [MetricsController],
})
export class MetricsModule {}
