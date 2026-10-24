import { Inject, Module, Optional, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { DB_HANDLE, type DbHandle } from "../common/http.js";
import { ResendWebhookController } from "./resend-webhook.controller.js";
import { PgResendEventStore, RESEND_EVENT_STORE, RESEND_WEBHOOK_SECRET, SUPPORT_EMAIL_QUEUE, SUPPORT_EMAIL_QUEUE_NAME } from "./support-email.constants.js";

/** Resend inbound webhook (ADR 0020): POST /webhooks/resend. */
@Module({
  controllers: [ResendWebhookController],
  providers: [
    { provide: RESEND_WEBHOOK_SECRET, useFactory: (): string | null => process.env["RESEND_WEBHOOK_SECRET"]?.trim() || null },
    { provide: RESEND_EVENT_STORE, useFactory: (handle: DbHandle) => new PgResendEventStore(handle.sql), inject: [DB_HANDLE] },
    {
      provide: SUPPORT_EMAIL_QUEUE,
      useFactory: (): Queue => {
        const connection = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", { maxRetriesPerRequest: null, lazyConnect: true });
        return new Queue(SUPPORT_EMAIL_QUEUE_NAME, { connection });
      },
    },
  ],
})
export class SupportEmailModule implements OnApplicationShutdown {
  constructor(@Optional() @Inject(SUPPORT_EMAIL_QUEUE) private readonly queue?: Queue) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.queue) return;
    const connection = (this.queue.opts.connection ?? undefined) as Redis | undefined;
    await this.queue.close().catch(() => undefined);
    connection?.disconnect?.();
  }
}
