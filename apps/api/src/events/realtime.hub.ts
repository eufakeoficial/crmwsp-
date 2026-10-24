import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import {
  inboxEventSchema,
  notificationEventSchema,
  supportEventSchema,
  type InboxEvent,
  type NotificationEvent,
  type SupportEvent,
} from "@crmwsp/contracts";
import { z } from "zod";
import { Redis } from "ioredis";

/** Everything forwarded over SSE: inbox/AI events, team notifications and support ticket updates. */
export type RealtimeEvent = InboxEvent | NotificationEvent | SupportEvent;
export const realtimeEventSchema = z.union([inboxEventSchema, notificationEventSchema, supportEventSchema]);
export type RealtimeListener = (event: RealtimeEvent) => void;

export const tenantChannel = (tenantId: string): string => `tenant:${tenantId}:events`;
const CHANNEL_RE = /^tenant:([0-9a-f-]{36}):events$/i;
/** Support inbox of the platform backoffice (ADR 0016); not tied to a tenant. Also its listener key. */
export const PLATFORM_SUPPORT_CHANNEL = "platform:support:events";
const channelOf = (key: string): string => (key === PLATFORM_SUPPORT_CHANNEL ? key : tenantChannel(key));

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
    const key = channel === PLATFORM_SUPPORT_CHANNEL ? channel : CHANNEL_RE.exec(channel)?.[1]?.toLowerCase();
    if (!key) return;
    const set = this.listeners.get(key);
    if (!set || set.size === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const event = realtimeEventSchema.safeParse(parsed);
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
    return this.subscribeKey(tenantId.toLowerCase(), listener);
  }

  /** Platform support inbox stream. The caller must have passed PlatformAdminGuard. */
  subscribePlatformSupport(listener: RealtimeListener): Promise<() => void> {
    return this.subscribeKey(PLATFORM_SUPPORT_CHANNEL, listener);
  }

  private async subscribeKey(key: string, listener: RealtimeListener): Promise<() => void> {
    let set = this.listeners.get(key);
    const first = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    if (first) await this.sub().subscribe(channelOf(key));
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.listeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(key);
        void this.subscriber?.unsubscribe(channelOf(key)).catch(() => undefined);
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
  async publish(tenantId: string, event: RealtimeEvent): Promise<void> {
    await this.publishTo(tenantChannel(tenantId), event);
  }

  /** Best effort, like publish(). Ids only. */
  async publishPlatformSupport(event: SupportEvent): Promise<void> {
    await this.publishTo(PLATFORM_SUPPORT_CHANNEL, event);
  }

  private async publishTo(channel: string, event: RealtimeEvent): Promise<void> {
    try {
      if (!this.publisher) {
        this.publisher = new Redis(this.redisUrl, { maxRetriesPerRequest: 1 });
        this.publisher.on("error", (err: Error) => this.logger.warn(`redis publisher error (${err.name})`));
      }
      await this.publisher.publish(channel, JSON.stringify(event));
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
