import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CurrencySettingsController } from "./currency-settings.controller.js";
import { InboxSettingsController } from "./inbox-settings.controller.js";
import { BusinessCategoryController, PublicBusinessCategoriesController } from "./business-category.js";

@Module({
  imports: [AuthModule],
  controllers: [InboxSettingsController, CurrencySettingsController, BusinessCategoryController, PublicBusinessCategoriesController],
})
export class SettingsModule {}
