import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createDb, type DbHandle, inArray, tenants, users } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

const APP_URL = process.env["DATABASE_URL"];
const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
const hasDb = Boolean(APP_URL && MIGRATOR_URL);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
  body: string;
}

const sessionCookieOf = (res: InjectResult): string => {
  const raw = res.headers["set-cookie"];
  const line = (Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "";
  const pair = line.split(";")[0] ?? "";
  if (!pair.startsWith("__Host-crmwsp_session=") || pair === "__Host-crmwsp_session=") throw new Error("no session cookie");
  return pair;
};

describe.skipIf(!hasDb)("auth + tenant context (e2e, Fastify inject, real Postgres)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const accounts = {
    a: { email: `e2e-a-${suffix}@example.test`, name: "Ana", password, tenantName: "Tenant A", tenantSlug: `e2e-a-${suffix}` },
    b: { email: `e2e-b-${suffix}@example.test`, name: "Bea", password, tenantName: "Tenant B", tenantSlug: `e2e-b-${suffix}` },
  };
  const state: { cookieA?: string; cookieB?: string; tenantA?: string | undefined; tenantB?: string | undefined } = {};

  const inject = (opts: {
    method: "GET" | "POST";
    url: string;
    payload?: unknown;
    cookie?: string | undefined;
    tenant?: string | undefined;
    headers?: Record<string, string>;
  }): Promise<InjectResult> =>
    app.inject({
      method: opts.method,
      url: opts.url,
      ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
      headers: {
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.tenant ? { "x-tenant-id": opts.tenant } : {}),
        ...(opts.headers ?? {}),
      },
    }) as unknown as Promise<InjectResult>;

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    // Same bootstrap as main.ts: WebhooksModule needs the Fastify adapter while providers are built.
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, [accounts.a.tenantSlug, accounts.b.tenantSlug]));
      await migrator.db.delete(users).where(inArray(users.email, [accounts.a.email, accounts.b.email]));
      await migrator.close();
    }
  });

  it("signup sets a secure HttpOnly cookie and /auth/me returns user + tenants", async () => {
    const res = await inject({ method: "POST", url: "/auth/signup", payload: accounts.a });
    expect(res.statusCode).toBe(201);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=\d+/);
    state.cookieA = sessionCookieOf(res);

    const me = await inject({ method: "GET", url: "/auth/me", cookie: state.cookieA });
    expect(me.statusCode).toBe(200);
    const body = me.json() as { user: { email: string }; tenants: { id: string; role: string; slug: string }[] };
    expect(body.user.email).toBe(accounts.a.email);
    expect(body.tenants).toHaveLength(1);
    expect(body.tenants[0]).toMatchObject({ role: "owner", slug: accounts.a.tenantSlug });
    state.tenantA = body.tenants[0]?.id;
    expect(JSON.stringify(body)).not.toMatch(/scrypt|password/i);

    const resB = await inject({ method: "POST", url: "/auth/signup", payload: accounts.b });
    expect(resB.statusCode).toBe(201);
    state.cookieB = sessionCookieOf(resB);
    state.tenantB = (resB.json() as { tenants: { id: string }[] }).tenants[0]?.id;
  });

  it("signup with an existing email gets a generic 409", async () => {
    const res = await inject({
      method: "POST",
      url: "/auth/signup",
      payload: { ...accounts.a, email: accounts.a.email.toUpperCase(), tenantSlug: `e2e-x-${suffix}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: "CONFLICT", message: "Signup could not be completed" });
  });

  it("signup validation errors do not echo the password", async () => {
    const res = await inject({ method: "POST", url: "/auth/signup", payload: { ...accounts.a, password: "short-pw" } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe("VALIDATION_ERROR");
    expect(res.body).not.toContain("short-pw");
  });

  it("login with a wrong password or unknown email returns the same generic 401", async () => {
    const wrong = await inject({ method: "POST", url: "/auth/login", payload: { email: accounts.a.email, password: "nope-nope-nope" } });
    const unknown = await inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: `ghost-${suffix}@example.test`, password: "nope-nope-nope" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json()).toEqual({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("login works and logout invalidates the session", async () => {
    const login = await inject({ method: "POST", url: "/auth/login", payload: { email: accounts.a.email, password } });
    expect(login.statusCode).toBe(200);
    const cookie = sessionCookieOf(login);
    expect((await inject({ method: "GET", url: "/auth/me", cookie })).statusCode).toBe(200);

    const out = await inject({ method: "POST", url: "/auth/logout", cookie });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
    const after = await inject({ method: "GET", url: "/auth/me", cookie });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized" });
    // The other session of the same user is still valid.
    expect((await inject({ method: "GET", url: "/auth/me", cookie: state.cookieA })).statusCode).toBe(200);
  });

  it("no cookie or a forged cookie gets 401", async () => {
    expect((await inject({ method: "GET", url: "/auth/me" })).statusCode).toBe(401);
    const forged = `__Host-crmwsp_session=${"A".repeat(43)}`;
    expect((await inject({ method: "GET", url: "/auth/me", cookie: forged })).statusCode).toBe(401);
  });

  it("cookie of a user of A with x-tenant-id of B gets 403", async () => {
    const res = await inject({ method: "GET", url: "/tenant/members", cookie: state.cookieA, tenant: state.tenantB });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("FORBIDDEN");
    const missing = await inject({ method: "GET", url: "/tenant/members", cookie: state.cookieA });
    expect(missing.statusCode).toBe(400);
  });

  it("/tenant/members only lists members of the current tenant (RLS, app role)", async () => {
    const res = await inject({ method: "GET", url: "/tenant/members", cookie: state.cookieA, tenant: state.tenantA });
    expect(res.statusCode).toBe(200);
    const { items } = res.json() as { items: { email: string; role: string }[] };
    expect(items).toEqual([expect.objectContaining({ email: accounts.a.email, role: "owner" })]);
    expect(items.map((i) => i.email)).not.toContain(accounts.b.email);

    const resB = await inject({ method: "GET", url: "/tenant/members", cookie: state.cookieB, tenant: state.tenantB });
    expect((resB.json() as { items: { email: string }[] }).items.map((i) => i.email)).toEqual([accounts.b.email]);
  });

  it("unknown routes go through the global error filter", async () => {
    const res = await inject({ method: "GET", url: "/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: "NOT_FOUND", message: "Not found" });
  });

  it("login rate limit kicks in after 10 attempts per IP+email", async () => {
    const payload = { email: `limited-${suffix}@example.test`, password: "whatever-123" };
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await inject({ method: "POST", url: "/auth/login", payload })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    // Another email from the same IP is not affected.
    const other = await inject({ method: "POST", url: "/auth/login", payload: { ...payload, email: `free-${suffix}@example.test` } });
    expect(other.statusCode).toBe(401);
  });

  it("session is required by default (global guard); only @Public routes are open", async () => {
    expect((await inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const noCookie = await inject({ method: "GET", url: "/tenant/members", tenant: state.tenantA });
    expect(noCookie.statusCode).toBe(401);
    expect(noCookie.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized" });
  });

  it("authenticated requests refresh the cookie with Max-Age bounded by the session", async () => {
    const me = await inject({ method: "GET", url: "/auth/me", cookie: state.cookieA });
    const line = String(me.headers["set-cookie"]);
    expect(line).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(line)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(30 * 24 * 3600);
  });

  it("CSRF: cross-origin state-changing requests are rejected with a generic 403", async () => {
    const evil = { origin: "https://evil.example" };
    const login = await inject({ method: "POST", url: "/auth/login", payload: { email: accounts.a.email, password }, headers: evil });
    expect(login.statusCode).toBe(403);
    expect(login.json()).toEqual({ code: "FORBIDDEN", message: "Forbidden" });
    expect(login.headers["set-cookie"]).toBeUndefined();
    const fetchMeta = await inject({ method: "POST", url: "/auth/logout", cookie: state.cookieA, headers: { "sec-fetch-site": "cross-site" } });
    expect(fetchMeta.statusCode).toBe(403);
    expect((await inject({ method: "GET", url: "/auth/me", cookie: state.cookieA })).statusCode).toBe(200);
    const nullOrigin = await inject({ method: "POST", url: "/auth/signup", payload: accounts.a, headers: { origin: "null" } });
    expect(nullOrigin.statusCode).toBe(403);
    // Same-origin (Origin host == Host) is fine.
    const same = await inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: accounts.a.email, password: "nope-nope-nope" },
      headers: { origin: "http://localhost:80", host: "localhost:80" },
    });
    expect(same.statusCode).toBe(401);
  });
});
