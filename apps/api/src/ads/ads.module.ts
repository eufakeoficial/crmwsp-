import { Inject, Module, Optional, type OnApplicationShutdown } from "@nestjs/common";
import { META_ADS_QUEUE_NAME } from "@crmwsp/contracts";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { AuthModule } from "../auth/auth.module.js";
import { ChannelsModule } from "../channels/channels.module.js";
import { AdsController, MetaAdsController, MetaCapiController } from "./ads.controller.js";
import { META_ADS_FETCH, META_ADS_QUEUE } from "./ads.constants.js";
import { defaultMetaFetch } from "./meta-ads.client.js";

@Module({
  imports: [AuthModule, ChannelsModule],
  controllers: [AdsController, MetaCapiController, MetaAdsController],
  providers: [
    { provide: META_ADS_FETCH, useValue: defaultMetaFetch },
    {
      provide: META_ADS_QUEUE,
      useFactory: (): Queue => {
        const connection = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", { maxRetriesPerRequest: null, lazyConnect: true });
        return new Queue(process.env["META_ADS_QUEUE_NAME"] ?? META_ADS_QUEUE_NAME, { connection });
      },
    },
  ],
})
export class AdsModule implements OnApplicationShutdown {
  constructor(@Optional() @Inject(META_ADS_QUEUE) private readonly queue?: Queue) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.queue) return;
    const connection = (this.queue.opts.connection ?? undefined) as Redis | undefined;
    await this.queue.close().catch(() => undefined);
    connection?.disconnect?.();
  }
}
