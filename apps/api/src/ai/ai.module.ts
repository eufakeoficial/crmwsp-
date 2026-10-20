import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { AuthModule } from "../auth/auth.module.js";
import { ChannelsModule } from "../channels/channels.module.js";
import { ElevenLabsTTSProvider, type TTSProvider } from "@crmwsp/ai";
import { AI_QUEUE, TTS_PROVIDER, aiQueueName } from "./ai.constants.js";
import { VoiceController } from "./voice.controller.js";
import { AiActionsController } from "./ai-actions.controller.js";
import { AiController } from "./ai.controller.js";
import { BotTemplatesController } from "./bot-templates.controller.js";
import { LlmProviderFactory } from "./llm-provider.factory.js";
import { SimulatorController } from "./simulator.controller.js";
import { SimulatorService } from "./simulator.service.js";
import { BillingModule } from "../billing/billing.module.js";

@Module({
  imports: [AuthModule, ChannelsModule, BillingModule],
  controllers: [AiController, AiActionsController, BotTemplatesController, VoiceController, SimulatorController],
  providers: [
    LlmProviderFactory,
    SimulatorService,
    { provide: TTS_PROVIDER, useFactory: (): TTSProvider => new ElevenLabsTTSProvider() },
    {
      provide: AI_QUEUE,
      useFactory: (): Queue => {
        const connection = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", {
          maxRetriesPerRequest: null,
          lazyConnect: true,
        });
        return new Queue(aiQueueName(), { connection });
      },
    },
  ],
  exports: [AI_QUEUE],
})
export class AiModule implements OnApplicationShutdown {
  constructor(@Inject(AI_QUEUE) private readonly queue: Queue) {}

  async onApplicationShutdown(): Promise<void> {
    const connection = (this.queue.opts.connection ?? undefined) as Redis | undefined;
    await this.queue.close().catch(() => undefined);
    connection?.disconnect?.();
  }
}
