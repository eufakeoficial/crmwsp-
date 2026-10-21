import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { channelConnections, createDb, dangerouslyWithoutTenant, inboundEvents, tenants, withTenant, type DbHandle } from "@crmwsp/db";
import { generateWebhookToken } from "@crmwsp/whatsapp";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Readable } from "node:stream";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgInboundEventStore, type InboundEventStore } from "../inbound-event-store.js";
import { WebhookRateLimiter, type RateLimiterOptions } from "../rate-limiter.js";
import { MemoryCounterStore } from "../../common/rate-limit-store.js";
import { UNAUTHORIZED_MIN_MS } from "../webhooks.controller.js";
import { WebhooksModule } from "../webhooks.module.js";

const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
const APP_URL = process.env["DATABASE_URL"];
const REDIS_URL = process.env["REDIS_URL"];
const hasEnv = Boolean(MIGRATOR_URL && APP_URL && REDIS_URL);

function textPayload(id: string): unknown {
  return {
    app: "DemoApp",
    timestamp: 1729339200000,
    version: 2,
    type: "message",
    payload: { id, source: "5491155551234", type: "text", payload: { text: "Hola" }, sender: { phone: "5491155551234", name: "Juan" } },
  };
}

class CountingStore implements InboundEventStore {
  calls = 0;
  constructor(private readonly inner: InboundEventStore) {}
  ingest(...args: Parameters<InboundEventStore["ingest"]>): ReturnType<InboundEventStore["ingest"]> {
    this.calls += 1;
    return this.inner.ingest(...args);
  }
}

describe.skipIf(!hasEnv)("POST /webhooks/gupshup/:webhookToken", () => {
  let migrator: DbHandle;
  let db: DbHandle;
  const queues: Queue[] = [];
  const apps: NestFastifyApplication[] = [];
  const tenantIds: string[] = [];
  let tokenA: string;
  let tokenB: string;

  async function makeApp(rateLimit?: RateLimiterOptions, adapterBodyLimit?: number): Promise<{ app: NestFastifyApplication; queue: Queue; store: CountingStore }> {
    const queue = new Queue(`inbound-test-${randomUUID()}`, {
      connection: new Redis(REDIS_URL as string, { maxRetriesPerRequest: null }),
    });
    queues.push(queue);
    const store = new CountingStore(new PgInboundEventStore(db.sql));
    const app = await NestFactory.create<NestFastifyApplication>(
      WebhooksModule.forRoot({ queue, store, ...(rateLimit ? { rateLimit } : {}) }),
      new FastifyAdapter(adapterBodyLimit ? { bodyLimit: adapterBodyLimit } : undefined),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    apps.push(app);
    return { app, queue, store };
  }

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    db = createDb(APP_URL as string);
    const suffix = randomUUID().slice(0, 8);
    [tokenA, tokenB] = await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const out: string[] = [];
      for (const label of ["a", "b"]) {
        const [t] = await tx.insert(tenants).values({ slug: `wh-${label}-${suffix}`, name: label }).returning({ id: tenants.id });
        if (!t) throw new Error("seed failed");
        tenantIds.push(t.id);
        const token = generateWebhookToken();
        await tx
          .insert(channelConnections)
          .values({ tenantId: t.id, provider: "gupshup", phoneE164: "+34600000001", webhookToken: token, status: "active" });
        out.push(token);
      }
      return out as [string, string];
    });
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
    for (const q of queues) {
      await q.obliterate({ force: true });
      await q.close();
    }
    if (migrator) {
      // Raw postgres.js: apps/api is CJS, importing drizzle-orm here would mix two builds.
      if (tenantIds.length) await migrator.sql`delete from public.tenants where id = any(${tenantIds}::uuid[])`;
      await migrator.close();
    }
    await db?.close();
  });

  it("valid token inserts the event and enqueues ingest-message", async () => {
    const { app, queue } = await makeApp();
    const extId = `wamid-${randomUUID()}`;
    const res = await app.inject({ method: "POST", url: `/webhooks/gupshup/${tokenA}`, payload: textPayload(extId) as object });
    expect(res.statusCode).toBe(200);
    const jobs = await queue.getJobs(["waiting"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe("ingest-message");
    const { eventId, tenantId } = jobs[0]?.data as { eventId: string; tenantId: string };
    expect(jobs[0]?.id).toBe(eventId);
    expect(tenantId).toBe(tenantIds[0]);
    const rows = await withTenant(db.db, tenantId, (tx) => tx.select().from(inboundEvents));
    expect(rows.map((r) => r.id)).toContain(eventId);
    expect(rows.find((r) => r.id === eventId)?.dedupeKey).toBe(`msg:${extId}`);
  });

  it("same payload twice enqueues a single job", async () => {
    const { app, queue } = await makeApp();
    const payload = textPayload(`wamid-${randomUUID()}`) as object;
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "POST", url: `/webhooks/gupshup/${tokenB}`, payload });
      expect(res.statusCode).toBe(200);
    }
    expect(await queue.getJobCountByTypes("waiting", "delayed", "active", "completed", "failed")).toBe(1);
  });

  it("unknown token -> 401 with empty body", async () => {
    const { app, queue, store } = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/gupshup/${generateWebhookToken()}`,
      payload: textPayload(`wamid-${randomUUID()}`) as object,
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe("");
    expect(store.calls).toBe(1);
    expect(await queue.getJobCountByTypes("waiting")).toBe(0);
  });

  it("malformed token -> 401 without touching the DB", async () => {
    const { app, store } = await makeApp();
    for (const bad of ["short", `${"a".repeat(42)}$`, "a".repeat(44)]) {
      const res = await app.inject({ method: "POST", url: `/webhooks/gupshup/${encodeURIComponent(bad)}`, payload: {} });
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe("");
    }
    expect(store.calls).toBe(0);
  });

  it("body over 1 MiB -> 413", async () => {
    const { app, store } = await makeApp();
    const big = JSON.stringify({ pad: "x".repeat(1024 * 1024 + 10) });
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/gupshup/${tokenA}`,
      headers: { "content-type": "application/json" },
      payload: big,
    });
    expect(res.statusCode).toBe(413);
    expect(store.calls).toBe(0);
  });

  it("unknown payloads answer 200 (no BSP retry loop) and are stored once for audit", async () => {
    const { app, queue } = await makeApp();
    const payload = { app: "DemoApp", type: "user-event", payload: { type: "sandbox-start", phone: "1", n: randomUUID() } };
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "POST", url: `/webhooks/gupshup/${tokenA}`, payload });
      expect(res.statusCode).toBe(200);
    }
    expect(await queue.getJobCountByTypes("waiting")).toBe(0);
    const tenantId = tenantIds[0] as string;
    const rows = await withTenant(db.db, tenantId, (tx) => tx.select().from(inboundEvents));
    expect(rows.filter((r) => r.dedupeKey.startsWith("ignored:") && JSON.stringify(r.payload).includes(payload.payload.n))).toHaveLength(1);
  });

  it("GET verification -> 200", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: `/webhooks/gupshup/${tokenA}` });
    expect(res.statusCode).toBe(200);
  });

  it("rate limit per token kicks in with 429", async () => {
    const { app } = await makeApp({ windowMs: 60_000, maxPerToken: 3, maxPerIp: 100 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "POST", url: `/webhooks/gupshup/${tokenA}`, payload: textPayload(`wamid-${randomUUID()}`) as object });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });
  it("chunked body over 1 MiB -> 413 even if the server-wide bodyLimit is larger", async () => {
    const { app, store } = await makeApp(undefined, 10 * 1024 * 1024);
    const chunk = "x".repeat(64 * 1024);
    async function* gen(): AsyncGenerator<string> {
      yield '{"pad":"';
      for (let i = 0; i < 20; i++) yield chunk;
      yield '"}';
    }
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/gupshup/${tokenA}`,
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
      payload: Readable.from(gen()),
    });
    expect(res.statusCode).toBe(413);
    expect(store.calls).toBe(0);
  });

  it("malformed and unknown tokens are indistinguishable: 401, empty body, same time floor", async () => {
    const { app } = await makeApp();
    for (const url of [`/webhooks/gupshup/short`, `/webhooks/gupshup/${generateWebhookToken()}`]) {
      const t0 = Date.now();
      const res = await app.inject({ method: "POST", url, payload: textPayload(`wamid-${randomUUID()}`) as object });
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe("");
      expect(Date.now() - t0).toBeGreaterThanOrEqual(UNAUTHORIZED_MIN_MS - 5);
    }
  });
});

describe("WebhookRateLimiter memory", () => {
  it("never tracks more than maxKeys entries and drops expired windows", async () => {
    let now = 0;
    const store = new MemoryCounterStore(() => now, 100);
    const rl = new WebhookRateLimiter({ windowMs: 1_000, maxPerToken: 5, maxPerIp: 5 }, store);
    for (let i = 0; i < 10_000; i++) await rl.hit(`tok-${i}`, `ip-${i}`);
    expect(store.size).toBeLessThanOrEqual(100);
    now = 5_000;
    await rl.hit("fresh", "fresh-ip");
    for (let i = 0; i < 200; i++) await rl.hit(`late-${i}`, "fresh-ip");
    expect(store.size).toBeLessThanOrEqual(100);
  });

  it("applies the tighter per-connection cap when asked (weakAuth providers)", async () => {
    const rl = new WebhookRateLimiter({ windowMs: 60_000, maxPerToken: 600, maxPerIp: 1_200 }, new MemoryCounterStore());
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(await rl.hit("weak-token", `ip-${i}`, 3));
    expect(results).toEqual([true, true, true, false]);
  });
});
