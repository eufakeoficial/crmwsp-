import { describe, expect, it } from "vitest";
import { RateLimitedError } from "@crmwsp/contracts";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { InMemoryRateLimiter } from "../auth/rate-limiter.js";
import { maxAgeUntil } from "../auth/session.guard.js";
import { assertSameOriginForMutation } from "../common/csrf.js";
import { ForbiddenError } from "@crmwsp/contracts";
import { hashSessionToken, newSessionToken, readSessionToken } from "../auth/session-token.js";

describe("password hashing (scrypt)", () => {
  it("hashes with parameters in the format and verifies", async () => {
    const h = await hashPassword("correct-horse-1");
    expect(h).toMatch(/^scrypt\$ln=15,r=8,p=1\$/);
    expect(await verifyPassword(h, "correct-horse-1")).toBe(true);
    expect(await verifyPassword(h, "wrong-horse-1")).toBe(false);
    expect(await hashPassword("correct-horse-1")).not.toBe(h);
  });
  it("rejects malformed or abusive parameters without throwing", async () => {
    expect(await verifyPassword("garbage", "x")).toBe(false);
    expect(await verifyPassword("scrypt$ln=30,r=8,p=1$AAAA$AAAA", "x")).toBe(false);
    // Weak parameters injected in the DB are refused (minimum N = 2^14).
    const salt = Buffer.alloc(16, 1).toString("base64");
    const key = Buffer.alloc(32, 2).toString("base64");
    expect(await verifyPassword(`scrypt$ln=1,r=1,p=1$${salt}$${key}`, "x")).toBe(false);
    expect(await verifyPassword(`scrypt$ln=13,r=8,p=1$${salt}$${key}`, "x")).toBe(false);
    // Too-short salt is refused.
    expect(await verifyPassword(`scrypt$ln=15,r=8,p=1$AAAA$${key}`, "x")).toBe(false);
  });
});

describe("session tokens", () => {
  it("are 32 random bytes and hash to 32 bytes", () => {
    const t = newSessionToken();
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(hashSessionToken(t)).toHaveLength(32);
    expect(newSessionToken()).not.toBe(t);
  });
  it("reads only well-formed session cookies", () => {
    const t = newSessionToken();
    expect(readSessionToken({ headers: { cookie: `a=1; __Host-crmwsp_session=${t}` }, ip: "" })).toBe(t);
    expect(readSessionToken({ headers: { cookie: "__Host-crmwsp_session=bad" }, ip: "" })).toBeUndefined();
    expect(readSessionToken({ headers: {}, ip: "" })).toBeUndefined();
    // Quoted value.
    expect(readSessionToken({ headers: { cookie: `__Host-crmwsp_session="${t}"` }, ip: "" })).toBe(t);
    // Same value twice is fine; two different values are ambiguous => rejected.
    expect(readSessionToken({ headers: { cookie: `__Host-crmwsp_session=${t}; __Host-crmwsp_session=${t}` }, ip: "" })).toBe(t);
    const other = newSessionToken();
    expect(readSessionToken({ headers: { cookie: `__Host-crmwsp_session=${t}; __Host-crmwsp_session=${other}` }, ip: "" })).toBeUndefined();
    // Unprefixed (tossable) cookie name is ignored.
    expect(readSessionToken({ headers: { cookie: `crmwsp_session=${t}` }, ip: "" })).toBeUndefined();
    // Oversized header.
    expect(readSessionToken({ headers: { cookie: `x=${"a".repeat(10_000)}; __Host-crmwsp_session=${t}` }, ip: "" })).toBeUndefined();
  });
});

describe("InMemoryRateLimiter", () => {
  it("allows `limit` hits per window, then throws, then resets", () => {
    const rl = new InMemoryRateLimiter({ limit: 2, windowMs: 1000 });
    rl.consume("k", 0);
    rl.consume("k", 1);
    expect(() => rl.consume("k", 2)).toThrow(RateLimitedError);
    expect(() => rl.consume("other", 2)).not.toThrow();
    expect(() => rl.consume("k", 1001)).not.toThrow();
  });
});

describe("InMemoryRateLimiter memory bound", () => {
  it("sweeps expired windows and never exceeds maxKeys", () => {
    const rl = new InMemoryRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) rl.consume(`k${i}`, 0);
    expect(rl.size).toBeLessThanOrEqual(100);
    rl.consume("late", 5000);
    expect(rl.size).toBe(1);
  });
});

describe("cookie Max-Age", () => {
  it("never exceeds the remaining session lifetime", () => {
    expect(maxAgeUntil(new Date(10_000), 3600, 0)).toBe(10);
    expect(maxAgeUntil(new Date(10_000_000_000), 3600, 0)).toBe(3600);
    expect(maxAgeUntil(new Date(0), 3600, 1000)).toBe(0);
  });
});

describe("CSRF origin check", () => {
  const req = (method: string, headers: Record<string, string>) => ({ method, headers, ip: "" });
  it("allows safe methods, x-tenant-id, no Origin, allowed and same-host origins", () => {
    expect(() => assertSameOriginForMutation(req("GET", { origin: "https://evil.example" }), [])).not.toThrow();
    expect(() => assertSameOriginForMutation(req("POST", { origin: "https://evil.example", "x-tenant-id": "x" }), [])).not.toThrow();
    expect(() => assertSameOriginForMutation(req("POST", {}), [])).not.toThrow();
    expect(() => assertSameOriginForMutation(req("POST", { origin: "https://app.example" }), ["https://app.example"])).not.toThrow();
    expect(() => assertSameOriginForMutation(req("DELETE", { origin: "https://api.example", host: "api.example" }), [])).not.toThrow();
  });
  it("rejects foreign, null and cross-site requests", () => {
    expect(() => assertSameOriginForMutation(req("POST", { origin: "https://evil.example", host: "api.example" }), [])).toThrow(ForbiddenError);
    expect(() => assertSameOriginForMutation(req("POST", { origin: "null" }), [])).toThrow(ForbiddenError);
    expect(() => assertSameOriginForMutation(req("PATCH", { "sec-fetch-site": "cross-site" }), [])).toThrow(ForbiddenError);
  });
});
