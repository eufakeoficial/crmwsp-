import { Inject, Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { StripeProvider } from "@crmwsp/payments";
import { AuthModule } from "../auth/auth.module.js";
import { ChannelsModule } from "../channels/channels.module.js";
import { DB_HANDLE, type DbHandle } from "../common/http.js";
import { DEFAULT_RATE_LIMIT, WebhookRateLimiter } from "../webhooks/rate-limiter.js";
import { WebhookGuardMiddleware } from "../webhooks/webhook-guard.middleware.js";
import { WEBHOOK_BODY_LIMIT, WEBHOOK_RATE_LIMITER } from "../webhooks/webhooks.constants.js";
import { PaymentsController, type StripeProviderFactory } from "./payments.controller.js";
import { PAYMENT_LEDGER, PAYMENTS_CLOCK, STRIPE_PROVIDER_FACTORY, STRIPE_WEBHOOK_RESOLVER } from "./payments.constants.js";
import { PgPaymentLedger } from "./pg-payment-ledger.js";
import { StripeWebhookController } from "./stripe-webhook.controller.js";
import { PgStripeWebhookResolver, StripeWebhookService } from "./stripe-webhook.service.js";

const BODY_LIMIT_HOOK = Symbol("PAYMENTS_BODY_LIMIT_HOOK");

interface FastifyLike {
  addHook(name: "onRoute", fn: (route: { url: string; bodyLimit?: number }) => void): unknown;
}

/** Same 1 MiB streaming cap as the Gupshup webhook (see WebhooksCoreModule). */
function installBodyLimit(host: HttpAdapterHost): true {
  const instance = host.httpAdapter?.getInstance?.() as Partial<FastifyLike> | undefined;
  if (typeof instance?.addHook !== "function") throw new Error("PaymentsModule requires the Fastify adapter");
  instance.addHook("onRoute", (route) => {
    if (route.url.includes("/webhooks/stripe")) {
      route.bodyLimit = Math.min(route.bodyLimit ?? WEBHOOK_BODY_LIMIT, WEBHOOK_BODY_LIMIT);
    }
  });
  return true;
}

const stripeFactory: StripeProviderFactory = (options) => new StripeProvider(options);

@Module({
  imports: [AuthModule, ChannelsModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [
    { provide: BODY_LIMIT_HOOK, useFactory: installBodyLimit, inject: [HttpAdapterHost] },
    { provide: PAYMENT_LEDGER, useFactory: (h: DbHandle) => new PgPaymentLedger(h.db), inject: [DB_HANDLE] },
    { provide: STRIPE_WEBHOOK_RESOLVER, useFactory: (h: DbHandle) => new PgStripeWebhookResolver(h.sql), inject: [DB_HANDLE] },
    { provide: STRIPE_PROVIDER_FACTORY, useValue: stripeFactory },
    { provide: PAYMENTS_CLOCK, useValue: Date.now },
    { provide: WEBHOOK_RATE_LIMITER, useValue: new WebhookRateLimiter(DEFAULT_RATE_LIMIT) },
    StripeWebhookService,
    WebhookGuardMiddleware,
  ],
})
export class PaymentsModule implements NestModule {
  // Forces the body-limit hook to be installed before routes are registered.
  constructor(@Inject(BODY_LIMIT_HOOK) _bodyLimit: true) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(WebhookGuardMiddleware).forRoutes(StripeWebhookController);
  }
}
