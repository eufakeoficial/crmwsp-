import { Logger, Module } from "@nestjs/common";
import { createCipherBox, loadMasterKeysFromEnv, type CipherBox } from "@crmwsp/crypto";
import { AuthModule } from "../auth/auth.module.js";
import { CIPHER_BOX } from "./channels.constants.js";
import { ChannelsController } from "./channels.controller.js";

/**
 * Master keys are loaded once at startup. If they are missing or invalid the API
 * still boots; endpoints that need encryption answer 503.
 */
function cipherFromEnv(): CipherBox | null {
  try {
    return createCipherBox(loadMasterKeysFromEnv(process.env));
  } catch (err) {
    // MasterKeyError messages name variables, never key material.
    new Logger("ChannelsModule").warn(
      `channel credentials disabled: ${err instanceof Error ? err.message : "master keys unavailable"}`,
    );
    return null;
  }
}

@Module({
  imports: [AuthModule],
  controllers: [ChannelsController],
  providers: [{ provide: CIPHER_BOX, useFactory: cipherFromEnv }],
  // Shared with AiModule (same crypto box, other AAD purpose).
  exports: [CIPHER_BOX],
})
export class ChannelsModule {}
