import { Logger } from "@nestjs/common";
import { Redis } from "ioredis";

/**
 * Counter store behind every API rate limiter. Redis (shared across replicas, survives
 * restarts) with an in-memory fallback: if Redis is down we FAIL OPEN to per-process counting
 * (and warn) rather than locking every user out of login — availability over strictness.
 */
export interface CounterStore {
  /** Increments `key`, starting a `windowMs` window on first hit; returns the new count. */
  incr(key: string, windowMs: number): Promise<number>;
  /** Remaining TTL in ms of `key`, or 0 when absent. */
  ttl(key: string): Promise<number>;
  /** Sets `key` with a TTL (lock markers). */
  setPx(key: string, windowMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

export const RATE_LIMIT_STORE = Symbol("RATE_LIMIT_STORE");

export class MemoryCounterStore implements CounterStore {
  private readonly map = new Map<string, { count: number; resetAt: number }>();
  private nextSweep = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  get size(): number {
    return this.map.size;
  }

  private live(key: string, now: number) {
    const e = this.map.get(key);
    if (e && e.resetAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  private sweep(now: number): void {
    if (now < this.nextSweep && this.map.size < this.maxKeys) return;
    for (const [k, v] of this.map) if (v.resetAt <= now) this.map.delete(k);
    while (this.map.size >= this.maxKeys) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    this.nextSweep = now + 60_000;
  }

  incr(key: string, windowMs: number): Promise<number> {
    const now = this.now();
    this.sweep(now);
    const e = this.live(key, now);
    if (e) {
      e.count += 1;
      return Promise.resolve(e.count);
    }
    this.map.set(key, { count: 1, resetAt: now + windowMs });
    return Promise.resolve(1);
  }

  ttl(key: string): Promise<number> {
    const now = this.now();
    const e = this.live(key, now);
    return Promise.resolve(e ? e.resetAt - now : 0);
  }

  setPx(key: string, windowMs: number): Promise<void> {
    const now = this.now();
    this.sweep(now);
    this.map.set(key, { count: 1, resetAt: now + windowMs });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
}

/** INCR + PEXPIRE on first hit, atomically (fixed window). */
const INCR_SCRIPT = "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return c";

export class RedisCounterStore implements CounterStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "crmwsp:rl:",
  ) {}

  async incr(key: string, windowMs: number): Promise<number> {
    return Number(await this.redis.eval(INCR_SCRIPT, 1, this.prefix + key, String(windowMs)));
  }

  async ttl(key: string): Promise<number> {
    return Math.max(0, Number(await this.redis.pttl(this.prefix + key)));
  }

  async setPx(key: string, windowMs: number): Promise<void> {
    await this.redis.set(this.prefix + key, "1", "PX", windowMs);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}

/** Redis first; on any Redis error, the in-memory store (fail-open, warn at most once a minute). */
export class FallbackCounterStore implements CounterStore {
  private readonly logger = new Logger("RateLimitStore");
  private lastWarn = 0;

  constructor(
    private readonly primary: CounterStore,
    private readonly fallback: CounterStore = new MemoryCounterStore(),
  ) {}

  private async run<T>(fn: (s: CounterStore) => Promise<T>): Promise<T> {
    try {
      return await fn(this.primary);
    } catch (err) {
      const now = Date.now();
      if (now - this.lastWarn > 60_000) {
        this.lastWarn = now;
        this.logger.warn({ event: "rate_limit.redis_unavailable", error: (err as Error)?.name ?? "Error" });
      }
      return fn(this.fallback);
    }
  }

  incr(key: string, windowMs: number): Promise<number> {
    return this.run((s) => s.incr(key, windowMs));
  }
  ttl(key: string): Promise<number> {
    return this.run((s) => s.ttl(key));
  }
  setPx(key: string, windowMs: number): Promise<void> {
    return this.run((s) => s.setPx(key, windowMs));
  }
  del(key: string): Promise<void> {
    return this.run((s) => s.del(key));
  }
}

/** Short timeouts and no offline queue: a dead Redis must fail fast into the fallback. */
export function rateLimitRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 300,
    connectTimeout: 1_000,
  });
}

let shared: CounterStore | undefined;

/**
 * Process-wide store. Redis when REDIS_URL is set (unit tests under vitest stay in memory unless
 * they inject a store explicitly, so suites do not share counters across runs).
 */
export function defaultRateLimitStore(): CounterStore {
  if (shared) return shared;
  const url = process.env["REDIS_URL"];
  shared = url && !process.env["VITEST"] ? new FallbackCounterStore(new RedisCounterStore(rateLimitRedis(url))) : new MemoryCounterStore();
  return shared;
}
