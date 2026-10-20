import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InboxSettingsController } from "./inbox-settings.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [InboxSettingsController],
})
export class SettingsModule {}
