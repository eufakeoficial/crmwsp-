import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { AuthModule } from "../auth/auth.module.js";
import { EventsModule } from "../events/events.module.js";
import { ContactsController } from "./contacts.controller.js";
import { ConversationsController } from "./conversations.controller.js";
import { OUTBOUND_QUEUE, outboundQueueName } from "./outbound.constants.js";

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [ConversationsController, ContactsController],
  providers: [
    {
      provide: OUTBOUND_QUEUE,
      useFactory: (): Queue => {
        const connection = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", {
          maxRetriesPerRequest: null,
          lazyConnect: true,
        });
        return new Queue(outboundQueueName(), { connection });
      },
    },
  ],
  exports: [OUTBOUND_QUEUE],
})
export class InboxModule implements OnApplicationShutdown {
  constructor(@Inject(OUTBOUND_QUEUE) private readonly queue: Queue) {}

  async onApplicationShutdown(): Promise<void> {
    const connection = (this.queue.opts.connection ?? undefined) as Redis | undefined;
    await this.queue.close().catch(() => undefined);
    connection?.disconnect?.();
  }
}
