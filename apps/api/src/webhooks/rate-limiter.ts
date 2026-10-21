import { type CounterStore, defaultRateLimitStore } from "../common/rate-limit-store.js";

export interface RateLimiterOptions {
  windowMs: number;
  maxPerToken: number;
  maxPerIp: number;
  /** Kept for compatibility; the memory bound now lives in MemoryCounterStore. */
  maxKeys?: number;
}

export const DEFAULT_RATE_LIMIT: RateLimiterOptions = {
  windowMs: 60_000,
  maxPerToken: 600,
  maxPerIp: 1_200,
};

/**
 * Per-connection cap for webhooks authenticated only by a static/semi-public value
 * (`weakAuth` connectors: Gumroad, Hotmart, Payhip). Real sale volume is far below this.
 */
export const WEAK_AUTH_MAX_PER_TOKEN = 60;

/**
 * Fixed-window limiter keyed by webhook token and client IP, over the shared CounterStore
 * (Redis INCR + PEXPIRE in production, in-memory fallback; see common/rate-limit-store.ts).
 */
export class WebhookRateLimiter {
  constructor(
    private readonly options: RateLimiterOptions = DEFAULT_RATE_LIMIT,
    private readonly store: CounterStore = defaultRateLimitStore(),
  ) {}

  /** Resolves true when the request is allowed. Both buckets are charged. */
  async hit(token: string, ip: string, maxPerToken = this.options.maxPerToken): Promise<boolean> {
    const [t, i] = await Promise.all([
      this.store.incr(`wh:t:${token}`, this.options.windowMs),
      this.store.incr(`wh:i:${ip}`, this.options.windowMs),
    ]);
    return t <= Math.min(maxPerToken, this.options.maxPerToken) && i <= this.options.maxPerIp;
  }
}
