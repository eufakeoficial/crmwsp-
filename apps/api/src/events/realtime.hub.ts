import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { inboxEventSchema, type InboxEvent } from "@crmwsp/contracts";
import { Redis } from "ioredis";

export type RealtimeListener = (event: InboxEvent) => void;

export const tenantChannel = (tenantId: string): string => `tenant:${tenantId}:events`;
const CHANNEL_RE = /^tenant:([0-9a-f-]{36}):events$/i;

/**
 * Realtime fan-out. ONE shared Redis subscriber connection per process: it
 * subscribes to `tenant:<id>:events` while that tenant has at least one local
 * listener and fans events out in memory. Publishing uses a second connection
 * (a subscriber connection cannot issue other commands).
 */
@Injectable()
export class RealtimeHub implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeHub.name);
  private readonly listeners = new Map<string, Set<RealtimeListener>>();
  private subscriber: Redis | undefined;
  private publisher: Redis | undefined;
  private readonly redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";

  private sub(): Redis {
    if (!this.subscriber) {
      const s = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
      s.on("message", (channel: string, raw: string) => this.dispatch(channel, raw));
      s.on("error", (err: Error) => this.logger.warn(`redis subscriber error (${err.name})`));
      this.subscriber = s;
    }
    return this.subscriber;
  }

  private dispatch(channel: string, raw: string): void {
    const tenantId = CHANNEL_RE.exec(channel)?.[1];
    if (!tenantId) return;
    const set = this.listeners.get(tenantId.toLowerCase());
    if (!set || set.size === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const event = inboxEventSchema.safeParse(parsed);
    if (!event.success) return;
    for (const l of [...set]) {
      try {
        l(event.data);
      } catch {
        // A broken listener must not affect the others.
      }
    }
  }

  /** Registers a listener; resolves once the Redis subscription is active. Returns the unsubscribe fn. */
  async subscribe(tenantId: string, listener: RealtimeListener): Promise<() => void> {
    const key = tenantId.toLowerCase();
    let set = this.listeners.get(key);
    const first = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    if (first) await this.sub().subscribe(tenantChannel(key));
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.listeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(key);
        void this.subscriber?.unsubscribe(tenantChannel(key)).catch(() => undefined);
      }
    };
  }

  /** Number of local listeners (tests/metrics). */
  listenerCount(tenantId?: string): number {
    if (tenantId) return this.listeners.get(tenantId.toLowerCase())?.size ?? 0;
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }

  /** Best effort: data is already committed; clients can refetch. */
  async publish(tenantId: string, event: InboxEvent): Promise<void> {
    try {
      if (!this.publisher) {
        this.publisher = new Redis(this.redisUrl, { maxRetriesPerRequest: 1 });
        this.publisher.on("error", (err: Error) => this.logger.warn(`redis publisher error (${err.name})`));
      }
      await this.publisher.publish(tenantChannel(tenantId), JSON.stringify(event));
    } catch (err) {
      this.logger.warn(`publish failed (${err instanceof Error ? err.name : "unknown"})`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.listeners.clear();
    this.subscriber?.disconnect();
    this.publisher?.disconnect();
    this.subscriber = undefined;
    this.publisher = undefined;
  }
}
