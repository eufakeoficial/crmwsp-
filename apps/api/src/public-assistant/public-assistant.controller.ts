import { Body, Controller, HttpCode, Inject, Optional, Post, Req } from "@nestjs/common";
import { ValidationError, siteAssistantRequestSchema, type SiteAssistantResponse } from "@crmwsp/contracts";
import { Public } from "../auth/decorators.js";
import { type RateLimitOptions, StoreRateLimiter } from "../auth/rate-limiter.js";
import { clientIp } from "../common/client-ip.js";
import { type HttpRequest, headerValue } from "../common/http.js";
import { RATE_LIMIT_STORE, type CounterStore, defaultRateLimitStore } from "../common/rate-limit-store.js";
import { parseOrThrow } from "../common/zod.js";
import { SiteAssistantService } from "./site-assistant.service.js";

export const SITE_ASSISTANT_RATE_LIMITS = Symbol("SITE_ASSISTANT_RATE_LIMITS");
export interface SiteAssistantRateLimits {
  perMinute: RateLimitOptions;
  perDay: RateLimitOptions;
}
export const DEFAULT_SITE_ASSISTANT_RATE_LIMITS: SiteAssistantRateLimits = {
  perMinute: { limit: 10, windowMs: 60_000 },
  perDay: { limit: 60, windowMs: 24 * 60 * 60 * 1000 },
};
/** 12 messages x 500 chars plus JSON overhead fits well under this; the global Fastify limit (1 MiB) still applies first. */
export const SITE_ASSISTANT_MAX_BODY_BYTES = 16 * 1024;

/**
 * Public landing assistant. Unauthenticated, stateless (no conversation is stored) and abuse
 * bounded: per-IP minute/day limits, a global daily LLM budget (service) and a body cap.
 * Message content is never logged.
 */
@Controller("public/assistant")
@Public()
export class PublicAssistantController {
  private readonly minute: StoreRateLimiter;
  private readonly day: StoreRateLimiter;

  constructor(
    @Inject(SiteAssistantService) private readonly assistant: SiteAssistantService,
    @Inject(SITE_ASSISTANT_RATE_LIMITS) limits: SiteAssistantRateLimits,
    @Optional() @Inject(RATE_LIMIT_STORE) store?: CounterStore,
  ) {
    const s = store ?? defaultRateLimitStore();
    this.minute = new StoreRateLimiter(limits.perMinute, s, "sa:m");
    this.day = new StoreRateLimiter(limits.perDay, s, "sa:d");
  }

  @Post()
  @HttpCode(200)
  async ask(@Body() body: unknown, @Req() req: HttpRequest): Promise<SiteAssistantResponse> {
    const len = Number(headerValue(req, "content-length") ?? 0);
    if (len > SITE_ASSISTANT_MAX_BODY_BYTES) throw new ValidationError("Request too large");
    const ip = clientIp(req);
    await this.minute.consume(ip);
    await this.day.consume(ip);
    return this.assistant.answer(parseOrThrow(siteAssistantRequestSchema, body));
  }
}
