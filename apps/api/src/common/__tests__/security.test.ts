import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { AccountBackoff, StoreRateLimiter } from "../../auth/rate-limiter.js";
import { CLIENT_IP_HEADER, PROXY_SIG_HEADER, clientIp, installClientIpHook, resolveClientIp, signClientIp } from "../client-ip.js";
import { FallbackCounterStore, MemoryCounterStore, RedisCounterStore } from "../rate-limit-store.js";
import { registerSecurityHeaders } from "../security-headers.js";

const SECRET = "test-internal-proxy-secret";

const rawReq = (headers: Record<string, string>, socket = "10.0.0.5"): IncomingMessage =>
  ({ headers, socket: { remoteAddress: socket } }) as unknown as IncomingMessage;

const signed = (ip: string, ts = Date.now(), secret = SECRET) => ({ [CLIENT_IP_HEADER]: ip, [PROXY_SIG_HEADER]: signClientIp(secret, ip, ts) });

describe("resolveClientIp", () => {
  it("public path: trusts exactly one hop (Railway edge appends the client)", () => {
    const req = rawReq({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(resolveClientIp(req, { secret: SECRET, hops: 1 })).toBe("203.0.113.9");
  });

  it("web path: honours the forwarded IP only with a valid, fresh HMAC", () => {
    expect(resolveClientIp(rawReq(signed("198.51.100.7")), { secret: SECRET, hops: 1 })).toBe("198.51.100.7");
  });

  it("ignores a spoofed client-ip header without a valid signature", () => {
    const forged = { [CLIENT_IP_HEADER]: "1.2.3.4", [PROXY_SIG_HEADER]: `t=${Date.now()},v=${"0".repeat(64)}` };
    expect(resolveClientIp(rawReq({ ...forged, "x-forwarded-for": "203.0.113.9" }), { secret: SECRET, hops: 1 })).toBe("203.0.113.9");
    expect(resolveClientIp(rawReq({ ...signed("1.2.3.4", Date.now(), "other-secret"), "x-forwarded-for": "203.0.113.9" }), { secret: SECRET, hops: 1 })).toBe("203.0.113.9");
    expect(resolveClientIp(rawReq({ [CLIENT_IP_HEADER]: "1.2.3.4" }), { secret: SECRET, hops: 0 })).toBe("10.0.0.5");
  });

  it("rejects stale signatures and never trusts the header when no secret is configured", () => {
    expect(resolveClientIp(rawReq(signed("1.2.3.4", Date.now() - 5 * 60_000)), { secret: SECRET, hops: 0 })).toBe("10.0.0.5");
    expect(resolveClientIp(rawReq(signed("1.2.3.4")), { secret: undefined, hops: 0 })).toBe("10.0.0.5");
  });
});

describe("rate limit keyed by the real client IP", () => {
  @Controller()
  class PingController {
    @Get("ping")
    async ping(): Promise<{ ok: true }> {
      return { ok: true };
    }
  }
  @Module({ controllers: [PingController] })
  class PingModule {}

  let app: NestFastifyApplication | undefined;
  afterAll(async () => {
    if (app) await app.close();
  });

  it("two different forwarded IPs do not share a bucket; a forged header is ignored", async () => {
    process.env["INTERNAL_PROXY_SECRET"] = SECRET;
    const limiter = new StoreRateLimiter({ limit: 2, windowMs: 60_000 }, new MemoryCounterStore(), "t");
    app = await NestFactory.create<NestFastifyApplication>(PingModule, new FastifyAdapter(), { logger: false });
    const fastify = app.getHttpAdapter().getInstance();
    installClientIpHook(fastify);
    const seen: string[] = [];
    fastify.addHook("onRequest", async (req: { ip: string; raw: IncomingMessage }) => {
      seen.push(req.ip);
      if (!(await limiter.hit(clientIp(req)))) throw Object.assign(new Error("limited"), { statusCode: 429 });
    });
    await app.init();
    await fastify.ready();
    const call = (headers: Record<string, string>) => app!.inject({ method: "GET", url: "/ping", headers });

    const a = [await call(signed("198.51.100.1")), await call(signed("198.51.100.1")), await call(signed("198.51.100.1"))];
    expect(a.map((r) => r.statusCode)).toEqual([200, 200, 429]);
    expect((await call(signed("198.51.100.2"))).statusCode).toBe(200);
    // Forged header: falls back to the socket/hop address (inject = 127.0.0.1), its own bucket.
    const forged = { [CLIENT_IP_HEADER]: "198.51.100.2", [PROXY_SIG_HEADER]: `t=${Date.now()},v=${"a".repeat(64)}` };
    expect((await call(forged)).statusCode).toBe(200);
    expect(seen).toContain("198.51.100.1");
    expect(seen).not.toContain(undefined);
    expect(seen[seen.length - 1]).not.toBe("198.51.100.2");
    delete process.env["INTERNAL_PROXY_SECRET"];
  });
});

describe("security headers", () => {
  it("helmet headers are present on /health-like routes", async () => {
    @Controller()
    class HealthController {
      @Get("health")
      health(): { ok: true } {
        return { ok: true };
      }
    }
    @Module({ controllers: [HealthController] })
    class HealthModule {}
    const app = await NestFactory.create<NestFastifyApplication>(HealthModule, new FastifyAdapter(), { logger: false, rawBody: true });
    await registerSecurityHeaders(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=31536000/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toBeUndefined();
    await app.close();
  });
});

describe("account backoff", () => {
  it("locks an account after N failures regardless of IP, and clears on success", async () => {
    let now = 0;
    const store = new MemoryCounterStore(() => now);
    const bo = new AccountBackoff(store, { freeFailures: 2, baseMs: 1_000, maxMs: 10_000, memoryMs: 60_000 });
    expect(await bo.failure("acc")).toBe(0);
    expect(await bo.failure("acc")).toBe(0);
    expect(await bo.failure("acc")).toBe(1_000);
    await expect(bo.check("acc")).rejects.toThrow();
    expect(await bo.failure("acc")).toBe(2_000);
    now = 3_000;
    await expect(bo.check("acc")).resolves.toBeUndefined();
    await bo.success("acc");
    expect(await bo.failure("acc")).toBe(0);
  });
});

describe("fallback store", () => {
  it("fails open to memory when Redis errors", async () => {
    const broken = { incr: () => Promise.reject(new Error("down")) } as unknown as RedisCounterStore;
    const s = new FallbackCounterStore(broken, new MemoryCounterStore());
    expect(await s.incr("k", 1_000)).toBe(1);
    expect(await s.incr("k", 1_000)).toBe(2);
  });
});

describe.skipIf(!process.env["REDIS_URL"])("Redis-backed counters", () => {
  const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", { lazyConnect: true });
  afterAll(async () => {
    await redis.quit();
  });

  it("counts survive a new limiter instance", async () => {
    const prefix = `crmwsp:test:${Date.now()}:`;
    const opts = { limit: 2, windowMs: 60_000 };
    const first = new StoreRateLimiter(opts, new RedisCounterStore(redis, prefix), "auth");
    expect(await first.hit("ip:9.9.9.9")).toBe(true);
    expect(await first.hit("ip:9.9.9.9")).toBe(true);
    const second = new StoreRateLimiter(opts, new RedisCounterStore(redis, prefix), "auth");
    expect(await second.hit("ip:9.9.9.9")).toBe(false);
    expect(await redis.pttl(`${prefix}auth:ip:9.9.9.9`)).toBeGreaterThan(0);
  });
});
