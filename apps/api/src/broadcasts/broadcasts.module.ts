import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { BroadcastsController } from "./broadcasts.controller.js";

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [BroadcastsController],
})
export class BroadcastsModule {}
