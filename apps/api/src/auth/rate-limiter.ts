import { RateLimitedError } from "@crmwsp/contracts";
import type { CounterStore } from "../common/rate-limit-store.js";

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Hard cap on tracked keys (memory bound). Default 50_000. */
  maxKeys?: number;
}

export const AUTH_RATE_LIMIT = Symbol("AUTH_RATE_LIMIT");
export const AUTH_IP_RATE_LIMIT = Symbol("AUTH_IP_RATE_LIMIT");
export const ACCOUNT_BACKOFF = Symbol("ACCOUNT_BACKOFF");
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

/**
 * Fixed-window limiter over a CounterStore (Redis-backed in production; see
 * common/rate-limit-store.ts for the fail-open policy). Same keys/limits as the in-memory one.
 */
export class StoreRateLimiter {
  constructor(
    private readonly options: RateLimitOptions,
    private readonly store: CounterStore,
    private readonly namespace: string,
  ) {}

  /** Counts one attempt; throws RateLimitedError when over the limit. */
  async consume(key: string): Promise<void> {
    if (!(await this.hit(key))) throw new RateLimitedError();
  }

  /** Counts one attempt; false when over the limit. */
  async hit(key: string): Promise<boolean> {
    return (await this.store.incr(`${this.namespace}:${key}`, this.options.windowMs)) <= this.options.limit;
  }
}

export interface BackoffOptions {
  /** Failures tolerated before locking. */
  freeFailures: number;
  baseMs: number;
  maxMs: number;
  /** How long a failure streak is remembered. */
  memoryMs: number;
}

export const DEFAULT_ACCOUNT_BACKOFF: BackoffOptions = { freeFailures: 10, baseMs: 1_000, maxMs: 15 * 60 * 1000, memoryMs: 60 * 60 * 1000 };

/**
 * Per-account exponential backoff, independent of IP: after `freeFailures` failed logins the
 * account is locked for base * 2^(n - free - 1) ms (capped). A success clears the streak.
 * Keyed by a hash of the email so raw emails never reach Redis.
 */
export class AccountBackoff {
  constructor(
    private readonly store: CounterStore,
    private readonly options: BackoffOptions = DEFAULT_ACCOUNT_BACKOFF,
  ) {}

  /** Throws RateLimitedError while the account is locked. */
  async check(accountKey: string): Promise<void> {
    if ((await this.store.ttl(`bo:lock:${accountKey}`)) > 0) throw new RateLimitedError();
  }

  /** Returns the lock duration applied (0 = none). */
  async failure(accountKey: string): Promise<number> {
    const n = await this.store.incr(`bo:fail:${accountKey}`, this.options.memoryMs);
    const over = n - this.options.freeFailures;
    if (over <= 0) return 0;
    const ms = Math.min(this.options.maxMs, this.options.baseMs * 2 ** Math.min(over - 1, 30));
    await this.store.setPx(`bo:lock:${accountKey}`, ms);
    return ms;
  }

  async success(accountKey: string): Promise<void> {
    await this.store.del(`bo:fail:${accountKey}`);
  }
}
