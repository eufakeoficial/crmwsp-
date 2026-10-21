import { Inject, Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { createSafeFetch } from "@crmwsp/ai";
import type { FetchLike } from "@crmwsp/integrations";
import { AuthModule } from "../auth/auth.module.js";
import { ChannelsModule } from "../channels/channels.module.js";
import { DB_HANDLE, type DbHandle } from "../common/http.js";
import { DEFAULT_RATE_LIMIT, WebhookRateLimiter } from "../webhooks/rate-limiter.js";
import { WebhookGuardMiddleware } from "../webhooks/webhook-guard.middleware.js";
import { WEBHOOK_BODY_LIMIT, WEBHOOK_RATE_LIMITER } from "../webhooks/webhooks.constants.js";
import { CommerceWebhookController } from "./commerce-webhook.controller.js";
import { CommerceWebhookService, PgCommerceWebhookResolver } from "./commerce-webhook.service.js";
import { COMMERCE_FETCH, COMMERCE_LEDGER, COMMERCE_WEBHOOK_RESOLVER } from "./integrations.constants.js";
import { IntegrationsController } from "./integrations.controller.js";
import { PgCommerceLedger } from "./pg-commerce-ledger.js";

const BODY_LIMIT_HOOK = Symbol("INTEGRATIONS_BODY_LIMIT_HOOK");

interface FastifyLike {
  addHook(name: "onRoute", fn: (route: { url: string; bodyLimit?: number }) => void): unknown;
}

/** Same 1 MiB streaming cap as the other public webhooks. */
function installBodyLimit(host: HttpAdapterHost): true {
  const instance = host.httpAdapter?.getInstance?.() as Partial<FastifyLike> | undefined;
  if (typeof instance?.addHook !== "function") throw new Error("IntegrationsModule requires the Fastify adapter");
  instance.addHook("onRoute", (route) => {
    if (route.url.includes("/webhooks/commerce")) {
      route.bodyLimit = Math.min(route.bodyLimit ?? WEBHOOK_BODY_LIMIT, WEBHOOK_BODY_LIMIT);
    }
  });
  return true;
}

/**
 * DNS-pinned fetch (rejects private/loopback addresses at socket lookup, CN-009) with a hard
 * timeout; never follows redirects (the token must not leave the shop). WooCommerce site URLs are
 * tenant-supplied, so every catalog call goes through it.
 */
const safeFetch = createSafeFetch();
const timedFetch: FetchLike = (url, init) =>
  safeFetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });

@Module({
  imports: [AuthModule, ChannelsModule],
  controllers: [IntegrationsController, CommerceWebhookController],
  providers: [
    { provide: BODY_LIMIT_HOOK, useFactory: installBodyLimit, inject: [HttpAdapterHost] },
    { provide: COMMERCE_LEDGER, useFactory: (h: DbHandle) => new PgCommerceLedger(h.db), inject: [DB_HANDLE] },
    { provide: COMMERCE_WEBHOOK_RESOLVER, useFactory: (h: DbHandle) => new PgCommerceWebhookResolver(h.sql), inject: [DB_HANDLE] },
    { provide: COMMERCE_FETCH, useValue: timedFetch },
    { provide: WEBHOOK_RATE_LIMITER, useValue: new WebhookRateLimiter(DEFAULT_RATE_LIMIT) },
    CommerceWebhookService,
    WebhookGuardMiddleware,
  ],
})
export class IntegrationsModule implements NestModule {
  constructor(@Inject(BODY_LIMIT_HOOK) _bodyLimit: true) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(WebhookGuardMiddleware).forRoutes(CommerceWebhookController);
  }
}
