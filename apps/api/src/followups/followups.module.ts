import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FollowUpsController } from "./followups.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [FollowUpsController],
})
export class FollowUpsModule {}
