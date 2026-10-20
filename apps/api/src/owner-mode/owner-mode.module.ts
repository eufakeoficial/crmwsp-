import { Module } from "@nestjs/common";
import type { CipherBox } from "@crmwsp/crypto";
import { AuthModule } from "../auth/auth.module.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import { ChannelsModule } from "../channels/channels.module.js";
import { OWNER_CODE_SENDER, createOwnerCodeSender } from "./owner-mode.constants.js";
import { OwnerModeController } from "./owner-mode.controller.js";

@Module({
  imports: [AuthModule, ChannelsModule],
  controllers: [OwnerModeController],
  providers: [{ provide: OWNER_CODE_SENDER, useFactory: (cipher: CipherBox | null) => createOwnerCodeSender(cipher), inject: [CIPHER_BOX] }],
})
export class OwnerModeModule {}
