import {
  Inject,
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
  type OnApplicationShutdown,
  type Provider,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { createDb } from "@crmwsp/db";
import { createDefaultWhatsAppProvider, type WhatsAppProvider } from "@crmwsp/whatsapp";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PgInboundEventStore, type InboundEventStore } from "./inbound-event-store.js";
import { MemoryCounterStore } from "../common/rate-limit-store.js";
import { DEFAULT_RATE_LIMIT, WebhookRateLimiter, type RateLimiterOptions } from "./rate-limiter.js";
import { WebhookGuardMiddleware } from "./webhook-guard.middleware.js";
import {
  INBOUND_EVENT_STORE,
  INBOUND_QUEUE,
  INBOUND_QUEUE_NAME,
  WEBHOOK_BODY_LIMIT,
  WEBHOOK_RATE_LIMITER,
  WHATSAPP_PROVIDER,
} from "./webhooks.constants.js";
import { Dialog360WebhooksController, WebhooksController } from "./webhooks.controller.js";
import { WebhooksService } from "./webhooks.service.js";

export interface WebhooksModuleOptions {
  /** Inject a queue (tests). Default: queue "inbound" on REDIS_URL. */
  queue?: Queue;
  /** Inject a store (tests). Default: ingest_inbound_event over DATABASE_URL (app role). */
  store?: InboundEventStore;
  provider?: WhatsAppProvider;
  rateLimit?: RateLimiterOptions;
}

const CLOSERS = Symbol("WEBHOOKS_CLOSERS");
const BODY_LIMIT_HOOK = Symbol("WEBHOOKS_BODY_LIMIT_HOOK");

/** Structural view of the bits of Fastify used here (no direct fastify dependency). */
interface FastifyLike {
  addHook(name: "onRoute", fn: (route: { url: string; bodyLimit?: number }) => void): unknown;
}

/**
 * Pins Fastify's per-route `bodyLimit` (enforced while streaming, so it also covers chunked
 * bodies without content-length) on the webhook routes, independently of main.ts. Nest's
 * route decorators cannot set `bodyLimit`, so an onRoute hook is registered while providers
 * are instantiated, i.e. before Nest registers the controller routes.
 */
function installBodyLimit(host: HttpAdapterHost): true {
  const instance = host.httpAdapter?.getInstance?.() as Partial<FastifyLike> | undefined;
  if (typeof instance?.addHook !== "function") {
    throw new Error("WebhooksModule requires the Fastify adapter");
  }
  instance.addHook("onRoute", (route) => {
    if (route.url.includes("/webhooks/gupshup") || route.url.includes("/webhooks/360dialog")) {
      route.bodyLimit = Math.min(route.bodyLimit ?? WEBHOOK_BODY_LIMIT, WEBHOOK_BODY_LIMIT);
    }
  });
  return true;
}
type Closers = Array<() => Promise<unknown>>;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`WebhooksModule: ${name} is not set`);
  return v;
}

function buildProviders(options: WebhooksModuleOptions): Provider[] {
  const closers: Closers = [];
  return [
    { provide: CLOSERS, useValue: closers },
    { provide: BODY_LIMIT_HOOK, useFactory: installBodyLimit, inject: [HttpAdapterHost] },
    {
      provide: INBOUND_QUEUE,
      useFactory: (): Queue => {
        if (options.queue) return options.queue;
        const connection = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", {
          maxRetriesPerRequest: null,
          lazyConnect: true,
        });
        const queue = new Queue(INBOUND_QUEUE_NAME, { connection });
        closers.push(async () => {
          await queue.close();
          connection.disconnect();
        });
        return queue;
      },
    },
    {
      provide: INBOUND_EVENT_STORE,
      useFactory: (): InboundEventStore => {
        if (options.store) return options.store;
        const handle = createDb(requireEnv("DATABASE_URL"));
        closers.push(handle.close);
        return new PgInboundEventStore(handle.sql);
      },
    },
    { provide: WHATSAPP_PROVIDER, useValue: options.provider ?? createDefaultWhatsAppProvider() },
    {
      provide: WEBHOOK_RATE_LIMITER,
      // A custom limit (tests) gets its own counters instead of the shared process store.
      useValue: options.rateLimit ? new WebhookRateLimiter(options.rateLimit, new MemoryCounterStore()) : new WebhookRateLimiter(DEFAULT_RATE_LIMIT),
    },
    WebhooksService,
    WebhookGuardMiddleware,
  ];
}

/** Holds the controller, middleware and providers; built only through forRoot(). */
@Module({})
export class WebhooksCoreModule implements NestModule, OnApplicationShutdown {
  constructor(
    @Inject(CLOSERS) private readonly closers: Closers,
    // Forces the body-limit hook to be installed before routes are registered.
    @Inject(BODY_LIMIT_HOOK) _bodyLimit: true,
  ) {}

  static forRoot(options: WebhooksModuleOptions = {}): DynamicModule {
    return { module: WebhooksCoreModule, controllers: [WebhooksController, Dialog360WebhooksController], providers: buildProviders(options) };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(WebhookGuardMiddleware).forRoutes(WebhooksController, Dialog360WebhooksController);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.closers.splice(0).map((close) => close()));
  }
}

/**
 * Self-contained Gupshup webhook module. `imports: [WebhooksModule]` uses env defaults
 * (DATABASE_URL, REDIS_URL); `WebhooksModule.forRoot({...})` injects queue/store/limits (tests).
 */
@Module({ imports: [WebhooksCoreModule.forRoot()] })
export class WebhooksModule {
  static forRoot(options: WebhooksModuleOptions = {}): DynamicModule {
    return WebhooksCoreModule.forRoot(options);
  }
}
