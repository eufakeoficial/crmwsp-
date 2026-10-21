import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, auditEvents, createDb, type DbHandle, eq, inArray, tenants, users } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { hashEmail } from "../auth.service.js";

const APP_URL = process.env["DATABASE_URL"];
const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
const hasDb = Boolean(APP_URL && MIGRATOR_URL);

describe.skipIf(!hasDb)("auth audit events (e2e, real Postgres)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const account = { email: `audit-${suffix}@example.test`, name: "Ana", password: "correct-horse-battery", tenantName: "Audit", tenantSlug: `audit-${suffix}` };
  let tenantId = "";

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, [account.tenantSlug]));
      await migrator.db.delete(users).where(inArray(users.email, [account.email]));
      await migrator.close();
    }
  });

  const rows = (action: string) =>
    migrator.db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, action)));

  it("signup writes auth.signup", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/signup", payload: account });
    expect(res.statusCode).toBe(201);
    tenantId = (res.json() as { tenants: { id: string }[] }).tenants[0]?.id ?? "";
    expect(await rows("auth.signup")).toHaveLength(1);
  });

  it("a failed login writes auth.login_failed with a hashed email, ip and ua, never the password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: account.email, password: "wrong-password-123" },
      headers: { "user-agent": "audit-test-ua" },
    });
    expect(res.statusCode).toBe(401);
    const [row] = await rows("auth.login_failed");
    expect(row).toBeDefined();
    expect(row?.entity).toBe("auth");
    expect(row?.diff).toMatchObject({ email: hashEmail(account.email), ua: "audit-test-ua" });
    expect(row?.ip).toBeTruthy();
    const dump = JSON.stringify(row);
    expect(dump).not.toContain("wrong-password-123");
    expect(dump).not.toContain(account.email);
  });

  it("logout writes auth.logout", async () => {
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: account.email, password: account.password } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(await rows("auth.logout")).toHaveLength(1);
  });
});
