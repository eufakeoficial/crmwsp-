import { Module } from "@nestjs/common";
import { GupshupProfileClient } from "@crmwsp/whatsapp";
import { AuthModule } from "../auth/auth.module.js";
import { ChannelsModule } from "../channels/channels.module.js";
import { MultipartModule } from "../common/multipart.module.js";
import { GUPSHUP_PROFILE_CLIENT, WhatsappProfileController } from "./whatsapp-profile.controller.js";

@Module({
  imports: [AuthModule, ChannelsModule, MultipartModule],
  controllers: [WhatsappProfileController],
  providers: [{ provide: GUPSHUP_PROFILE_CLIENT, useFactory: (): GupshupProfileClient => new GupshupProfileClient() }],
})
export class WhatsappProfileModule {}
