import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { errorResponseSchema } from "@crmwsp/contracts";
import { createDb, eq, inArray, tenants, users } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

const hasEnv = Boolean(process.env["DATABASE_URL"] && process.env["DATABASE_URL_MIGRATOR"] && process.env["REDIS_URL"]);

describe.skipIf(!hasEnv)("channels without master keys", () => {
  let app: NestFastifyApplication;
  const suffix = randomUUID().slice(0, 8);
  const acc = { email: `nokeys-${suffix}@example.test`, name: "N", password: "correct-horse-battery", tenantName: "NK", tenantSlug: `nokeys-${suffix}` };

  beforeAll(async () => {
    delete process.env["ENCRYPTION_MASTER_KEY"];
    delete process.env["ENCRYPTION_MASTER_KEY_ID"];
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    const migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 1 });
    await migrator.db.delete(tenants).where(inArray(tenants.slug, [acc.tenantSlug]));
    await migrator.db.delete(users).where(inArray(users.email, [acc.email]));
    await migrator.close();
  });

  it("the API boots and channel creation answers 503 with a clear error", async () => {
    const signup = await app.inject({ method: "POST", url: "/auth/signup", payload: acc });
    expect(signup.statusCode).toBe(201);
    // Channel connection requires a verified owner email (0095).
    const migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 1 });
    await migrator.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, acc.email));
    await migrator.close();
    const cookie = String(signup.headers["set-cookie"]).split(";")[0] ?? "";
    const tenant = (signup.json() as { tenants: { id: string }[] }).tenants[0]!.id;
    const res = await app.inject({
      method: "POST",
      url: "/channels/gupshup",
      headers: { cookie, "x-tenant-id": tenant },
      payload: { phoneE164: "+34600000555", appName: "Demo", apiKey: "never-stored-123" },
    });
    expect(res.statusCode).toBe(503);
    const parsed = errorResponseSchema.parse(res.json());
    expect(parsed.code).toBe("ENCRYPTION_NOT_CONFIGURED");
    expect(res.json()).toMatchObject({ message: expect.stringMatching(/master keys are not configured/) });
    expect(res.body).not.toContain("never-stored-123");
    const list = await app.inject({ method: "GET", url: "/channels", headers: { cookie, "x-tenant-id": tenant } });
    expect(list.statusCode).toBe(200);
  });
});
