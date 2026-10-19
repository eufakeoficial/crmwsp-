import { RateLimitedError } from "@crmwsp/contracts";

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Hard cap on tracked keys (memory bound). Default 50_000. */
  maxKeys?: number;
}

export const AUTH_RATE_LIMIT = Symbol("AUTH_RATE_LIMIT");
export const AUTH_IP_RATE_LIMIT = Symbol("AUTH_IP_RATE_LIMIT");
/** Per IP+email on login/signup. */
export const DEFAULT_AUTH_RATE_LIMIT: RateLimitOptions = { limit: 10, windowMs: 15 * 60 * 1000 };
/** Global per IP across login/signup (stops spraying many emails from one IP). */
export const DEFAULT_AUTH_IP_RATE_LIMIT: RateLimitOptions = { limit: 100, windowMs: 15 * 60 * 1000 };

/**
 * Fixed-window, in-memory limiter keyed by e.g. "login:ip:email".
 * Memory is bounded: expired windows are swept and, at maxKeys, the oldest
 * entries (Map insertion order) are evicted.
 * TODO(F1): move to Redis (shared across API replicas, survives restarts).
 */
export class InMemoryRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly maxKeys: number;
  private nextSweep = 0;

  constructor(private readonly options: RateLimitOptions) {
    this.maxKeys = options.maxKeys ?? 50_000;
  }

  get size(): number {
    return this.hits.size;
  }

  /** Counts one attempt; throws RateLimitedError when over the limit. */
  consume(key: string, now = Date.now()): void {
    if (now >= this.nextSweep || this.hits.size >= this.maxKeys) {
      this.sweep(now);
      this.nextSweep = now + Math.min(this.options.windowMs, 60_000);
    }
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (entry) this.hits.delete(key);
      while (this.hits.size >= this.maxKeys) {
        const oldest = this.hits.keys().next().value;
        if (oldest === undefined) break;
        this.hits.delete(oldest);
      }
      this.hits.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > this.options.limit) throw new RateLimitedError();
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
