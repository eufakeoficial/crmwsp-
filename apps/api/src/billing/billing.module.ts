import { Inject, Module, Optional, type OnApplicationShutdown } from "@nestjs/common";
import { SUBSCRIPTION_BILLING_QUEUE_NAME } from "@crmwsp/contracts";
import { NowPaymentsProvider, nowPaymentsOptionsFromEnv } from "@crmwsp/payments";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { AuthModule } from "../auth/auth.module.js";
import { DB_HANDLE, type DbHandle } from "../common/http.js";
import { BillingController } from "./billing.controller.js";
import { NowPaymentsIpnController } from "./nowpayments-ipn.controller.js";
import { PlanLimitsService } from "./plan-limits.service.js";
import { NOWPAYMENTS_IPN_SECRET, NOWPAYMENTS_PROVIDER, SUBSCRIPTION_EVENT_STORE, SUBSCRIPTION_QUEUE } from "./subscription.constants.js";
import { PgSubscriptionEventStore, SubscriptionService } from "./subscription.service.js";

@Module({
  imports: [AuthModule],
  controllers: [BillingController, NowPaymentsIpnController],
  providers: [
    PlanLimitsService,
    SubscriptionService,
    {
      // Null when NOWPAYMENTS_API_KEY is unset: charge creation answers 502, nothing else breaks.
      provide: NOWPAYMENTS_PROVIDER,
      useFactory: (): NowPaymentsProvider | null => {
        const opts = nowPaymentsOptionsFromEnv(process.env);
        return opts ? new NowPaymentsProvider(opts) : null;
      },
    },
    { provide: NOWPAYMENTS_IPN_SECRET, useFactory: (): string | null => process.env["NOWPAYMENTS_IPN_SECRET"] || null },
    {
      provide: SUBSCRIPTION_EVENT_STORE,
      useFactory: (handle: DbHandle) => new PgSubscriptionEventStore(handle.sql),
      inject: [DB_HANDLE],
    },
    {
      provide: SUBSCRIPTION_QUEUE,
      useFactory: (): Queue => {
        const connection = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", { maxRetriesPerRequest: null, lazyConnect: true });
        return new Queue(SUBSCRIPTION_BILLING_QUEUE_NAME, { connection });
      },
    },
  ],
  exports: [PlanLimitsService],
})
export class BillingModule implements OnApplicationShutdown {
  constructor(@Optional() @Inject(SUBSCRIPTION_QUEUE) private readonly queue?: Queue) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.queue) return;
    const connection = (this.queue.opts.connection ?? undefined) as Redis | undefined;
    await this.queue.close().catch(() => undefined);
    connection?.disconnect?.();
  }
}
