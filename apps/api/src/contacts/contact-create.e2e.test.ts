import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { contactSchema, errorResponseSchema } from "@crmwsp/contracts";
import { contacts, createDb, eq, inArray, memberships, tenantPlans, tenants, users, type DbHandle } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

const hasEnv = Boolean(process.env["DATABASE_URL"] && process.env["DATABASE_URL_MIGRATOR"] && process.env["REDIS_URL"]);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
}

describe.skipIf(!hasEnv)("POST /contacts (e2e, real Postgres)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const mk = (k: string) => ({ email: `cc-${k}-${suffix}@example.test`, name: k.toUpperCase(), password, tenantName: `CC ${k}`, tenantSlug: `cc-${k}-${suffix}` });
  const accounts = { a: mk("a"), b: mk("b"), v: mk("v") };
  const s = {} as { cookieA: string; cookieB: string; cookieV: string; tenantA: string; tenantB: string };

  const post = (cookie: string, tenant: string, payload: unknown) =>
    app.inject({ method: "POST", url: "/contacts", payload: payload as object, headers: { cookie, "x-tenant-id": tenant } }) as unknown as Promise<InjectResult>;

  async function signup(acc: ReturnType<typeof mk>) {
    const res = (await app.inject({ method: "POST", url: "/auth/signup", payload: acc })) as unknown as InjectResult;
    expect(res.statusCode).toBe(201);
    const raw = res.headers["set-cookie"];
    const cookie = ((Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "").split(";")[0] ?? "";
    return { cookie, tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id };
  }

  beforeAll(async () => {
    migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 2 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    const v = await signup(accounts.v);
    Object.assign(s, { cookieA: a.cookie, tenantA: a.tenant, cookieB: b.cookie, tenantB: b.tenant, cookieV: v.cookie });
    // Signup leaves tenants in setup (ADR 0015): grandfather A and B (V joins A as a viewer).
    await migrator.db.update(tenantPlans).set({ setupEndsAt: null }).where(inArray(tenantPlans.tenantId, [s.tenantA, s.tenantB]));
    await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: (await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, accounts.v.email)))[0]!.id, role: "viewer" });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((x) => x.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((x) => x.email)));
      await migrator.close();
    }
  });

  it("creates a contact with a normalized phone, scoped to the tenant", async () => {
    const res = await post(s.cookieA, s.tenantA, { phone: "00 51 922-222-222", name: "Ana" });
    expect(res.statusCode).toBe(201);
    expect(contactSchema.parse(res.json())).toMatchObject({ phoneE164: "+51922222222", name: "Ana" });
    const [row] = await migrator.db.select({ tenantId: contacts.tenantId }).from(contacts).where(eq(contacts.phoneE164, "+51922222222"));
    expect(row?.tenantId).toBe(s.tenantA);
  });

  it("answers 409 with the existing contact id on a duplicate phone, but the same phone is free in another tenant", async () => {
    const dup = await post(s.cookieA, s.tenantA, { phone: "+51922222222" });
    expect(dup.statusCode).toBe(409);
    const body = errorResponseSchema.parse(dup.json());
    expect(JSON.stringify(body)).toMatch(/contactId/);
    expect((await post(s.cookieB, s.tenantB, { phone: "+51922222222" })).statusCode).toBe(201);
  });

  it("rejects invalid phones and viewers", async () => {
    expect((await post(s.cookieA, s.tenantA, { phone: "not a phone" })).statusCode).toBe(400);
    expect((await post(s.cookieV, s.tenantA, { phone: "+51933333333" })).statusCode).toBe(403);
  });
});
