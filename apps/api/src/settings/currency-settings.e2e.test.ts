import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { currencySettingsSchema, errorResponseSchema, providerSupportsCurrency } from "@crmwsp/contracts";
import { auditEvents, createDb, eq, inArray, memberships, tenants, users, type DbHandle } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

const hasEnv = Boolean(process.env["DATABASE_URL"] && process.env["DATABASE_URL_MIGRATOR"] && process.env["REDIS_URL"]);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
}

describe.skipIf(!hasEnv)("currency settings (e2e)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const mk = (k: string) => ({ email: `cur-${k}-${suffix}@example.test`, name: k.toUpperCase(), password: "correct-horse-battery", tenantName: `Cur ${k}`, tenantSlug: `cur-${k}-${suffix}` });
  const accounts = { a: mk("a"), c: mk("c") };
  const s = {} as { cookieA: string; cookieC: string; tenantA: string };

  const inject = (method: "GET" | "PATCH" | "POST", url: string, cookie: string, payload?: unknown) =>
    app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}), headers: { cookie, "x-tenant-id": s.tenantA } }) as unknown as Promise<InjectResult>;
  const cookieOf = (res: InjectResult) => {
    const raw = res.headers["set-cookie"];
    return ((Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "").split(";")[0] ?? "";
  };

  beforeAll(async () => {
    migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 2 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const ra = (await app.inject({ method: "POST", url: "/auth/signup", payload: accounts.a })) as unknown as InjectResult;
    const rc = (await app.inject({ method: "POST", url: "/auth/signup", payload: accounts.c })) as unknown as InjectResult;
    s.cookieA = cookieOf(ra);
    s.cookieC = cookieOf(rc);
    s.tenantA = (ra.json() as { tenants: { id: string }[] }).tenants[0]!.id;
    const [uc] = await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, accounts.c.email));
    await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: uc!.id, role: "agent" });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((x) => x.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((x) => x.email)));
      await migrator.close();
    }
  });

  it("returns the tenant currency as base and only enabled currency by default", async () => {
    const res = await inject("GET", "/settings/currency", s.cookieA);
    expect(res.statusCode).toBe(200);
    const body = currencySettingsSchema.parse(res.json());
    expect(body.enabled).toEqual([body.base]);
  });

  it("updates base and enabled list, base first, without touching other settings, and audits", async () => {
    const res = await inject("PATCH", "/settings/currency", s.cookieA, { base: "PEN", enabled: ["USD", "PEN", "USD"] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ base: "PEN", enabled: ["PEN", "USD"] });
    const [t] = await migrator.db.select().from(tenants).where(eq(tenants.id, s.tenantA));
    expect(t!.currency).toBe("PEN");
    expect(t!.settings["currencies"]).toEqual(["PEN", "USD"]);
    expect((await inject("GET", "/settings/currency", s.cookieA)).json()).toEqual({ base: "PEN", enabled: ["PEN", "USD"] });
    const audits = await migrator.db.select().from(auditEvents).where(eq(auditEvents.tenantId, s.tenantA));
    expect(audits.some((a) => a.action === "currency_settings.updated")).toBe(true);
  });

  it("rejects a currency outside the curated list", async () => {
    const res = await inject("PATCH", "/settings/currency", s.cookieA, { base: "GBP", enabled: ["GBP"] });
    expect(res.statusCode).toBe(400);
    errorResponseSchema.parse(res.json());
    expect((await inject("PATCH", "/settings/currency", s.cookieA, { base: "PEN", enabled: ["PEN", "XYZ"] })).statusCode).toBe(400);
  });

  it("rejects a base that is not enabled", async () => {
    const res = await inject("PATCH", "/settings/currency", s.cookieA, { base: "EUR", enabled: ["PEN", "USD"] });
    expect(res.statusCode).toBe(400);
  });

  it("forbids agents (403) but lets them read", async () => {
    expect((await inject("PATCH", "/settings/currency", s.cookieC, { base: "USD", enabled: ["USD"] })).statusCode).toBe(403);
    expect((await inject("GET", "/settings/currency", s.cookieC)).statusCode).toBe(200);
  });
});

describe("payment provider currency support", () => {
  it("Mercado Pago only accepts local LatAm currencies; Stripe any ISO code", () => {
    expect(providerSupportsCurrency("mercadopago", "PEN")).toBe(true);
    expect(providerSupportsCurrency("mercadopago", "USD")).toBe(false);
    expect(providerSupportsCurrency("mercadopago", "EUR")).toBe(false);
    expect(providerSupportsCurrency("stripe", "BOB")).toBe(true);
  });
});
