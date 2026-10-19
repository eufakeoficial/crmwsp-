export interface RateLimiterOptions {
  windowMs: number;
  maxPerToken: number;
  maxPerIp: number;
  /** Max tracked keys before expired windows are swept. */
  maxKeys?: number;
}

export const DEFAULT_RATE_LIMIT: RateLimiterOptions = {
  windowMs: 60_000,
  maxPerToken: 600,
  maxPerIp: 1_200,
};

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window, in-memory rate limiter keyed by webhook token and client IP.
 * TODO(F1): move to Redis (INCR + PEXPIRE) so limits hold across API replicas.
 */
export class WebhookRateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly maxKeys: number;

  constructor(
    private readonly options: RateLimiterOptions = DEFAULT_RATE_LIMIT,
    private readonly now: () => number = Date.now,
  ) {
    this.maxKeys = options.maxKeys ?? 50_000;
  }

  /** Returns true when the request is allowed. Both buckets are charged. */
  hit(token: string, ip: string): boolean {
    const t = this.charge(`t:${token}`, this.options.maxPerToken);
    const i = this.charge(`i:${ip}`, this.options.maxPerIp);
    return t && i;
  }

  private charge(key: string, max: number): boolean {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.windows.size >= this.maxKeys) this.sweep(now);
      w = { count: 0, resetAt: now + this.options.windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return w.count <= max;
  }

  private sweep(now: number): void {
    for (const [k, w] of this.windows) {
      if (w.resetAt <= now) this.windows.delete(k);
    }
    // Still full (flood of distinct keys): drop everything rather than grow unbounded.
    if (this.windows.size >= this.maxKeys) this.windows.clear();
  }
}
