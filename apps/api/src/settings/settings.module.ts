import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CurrencySettingsController } from "./currency-settings.controller.js";
import { InboxSettingsController } from "./inbox-settings.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [InboxSettingsController, CurrencySettingsController],
})
export class SettingsModule {}
