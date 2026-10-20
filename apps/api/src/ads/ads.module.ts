import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ChannelsModule } from "../channels/channels.module.js";
import { AdsController, MetaCapiController } from "./ads.controller.js";

@Module({
  imports: [AuthModule, ChannelsModule],
  controllers: [AdsController, MetaCapiController],
})
export class AdsModule {}
