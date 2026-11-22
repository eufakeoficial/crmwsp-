import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, auditEvents, createDb, eq, inArray, memberships, tenantPlans, tenants, users, type DbHandle } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

const APP_URL = process.env["DATABASE_URL"];
const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
const REDIS_URL = process.env["REDIS_URL"];
const hasEnv = Boolean(APP_URL && MIGRATOR_URL && REDIS_URL);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
}

const cookieOf = (res: InjectResult): string => {
  const raw = res.headers["set-cookie"];
  const line = (Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "";
  return line.split(";")[0] ?? "";
};

describe.skipIf(!hasEnv)("PATCH /tenant (e2e)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const mk = (k: string) => ({
    email: `ren-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password,
    tenantName: `Tenant ${k}`,
    tenantSlug: `ren-${k}-${suffix}`,
  });
  const accounts = { owner: mk("owner"), agent: mk("agent"), admin: mk("admin"), rival: mk("rival") };
  const cookies = {} as Record<keyof typeof accounts, string>;
  const userIds = {} as Record<keyof typeof accounts, string>;
  let tenantT = "";
  let tenantRival = "";

  const patch = (who: keyof typeof accounts, tenantId: string, payload: unknown) =>
    app.inject({ method: "PATCH", url: "/tenant", payload: payload as object, headers: { cookie: cookies[who], "x-tenant-id": tenantId } }) as unknown as Promise<InjectResult>;

  beforeAll(async () => {
    process.env["ENCRYPTION_MASTER_KEY"] = randomBytes(32).toString("base64");
    process.env["ENCRYPTION_MASTER_KEY_ID"] = "1";
    process.env["PUBLIC_API_URL"] = "https://api.example.test/";
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    for (const k of Object.keys(accounts) as (keyof typeof accounts)[]) {
      const res = (await app.inject({ method: "POST", url: "/auth/signup", payload: accounts[k] })) as unknown as InjectResult;
      expect(res.statusCode).toBe(201);
      cookies[k] = cookieOf(res);
      const id = (res.json() as { tenants: { id: string }[] }).tenants[0]!.id;
      if (k === "owner") tenantT = id;
      if (k === "rival") tenantRival = id;
      userIds[k] = (await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, accounts[k].email)))[0]!.id;
    }
    await migrator.db.insert(memberships).values([
      { tenantId: tenantT, userId: userIds.agent, role: "agent" },
      { tenantId: tenantT, userId: userIds.admin, role: "admin" },
    ]);
    await migrator.db.update(tenantPlans).set({ setupEndsAt: null }).where(inArray(tenantPlans.tenantId, [tenantT, tenantRival]));
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((a) => a.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((a) => a.email)));
      await migrator.close();
    }
  });

  it("owner renames the company (trimmed), slug untouched, audited", async () => {
    const res = await patch("owner", tenantT, { name: "  Nueva Empresa  " });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: tenantT, name: "Nueva Empresa" });
    const [row] = await migrator.db.select({ name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantT));
    expect(row).toEqual({ name: "Nueva Empresa", slug: accounts.owner.tenantSlug });
    const [ev] = await migrator.db
      .select({ diff: auditEvents.diff })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, tenantT), eq(auditEvents.entity, "tenant")));
    expect(ev?.diff).toEqual({ from: "Tenant owner", to: "Nueva Empresa" });
  });

  it("admin can rename; agent gets 403", async () => {
    expect((await patch("admin", tenantT, { name: "Por Admin" })).statusCode).toBe(200);
    expect((await patch("agent", tenantT, { name: "Por Agente" })).statusCode).toBe(403);
    const [row] = await migrator.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantT));
    expect(row?.name).toBe("Por Admin");
  });

  it("rejects invalid names and slug changes with 400", async () => {
    expect((await patch("owner", tenantT, { name: "a" })).statusCode).toBe(400);
    expect((await patch("owner", tenantT, { name: "x".repeat(81) })).statusCode).toBe(400);
    expect((await patch("owner", tenantT, { name: "Valida", slug: "hack" })).statusCode).toBe(400);
  });

  it("cannot rename another tenant", async () => {
    const res = await patch("owner", tenantRival, { name: "Hijacked" });
    expect([403, 404]).toContain(res.statusCode);
    const [row] = await migrator.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantRival));
    expect(row?.name).toBe("Tenant rival");
  });
  it("owner changes the time zone; audited from/to; GET /tenant reflects it", async () => {
    const res = await patch("owner", tenantT, { timezone: "America/Lima" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: tenantT, timezone: "America/Lima" });
    const [row] = await migrator.db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantT));
    expect(row?.tz).toBe("America/Lima");
    const got = (await app.inject({ method: "GET", url: "/tenant", headers: { cookie: cookies.agent, "x-tenant-id": tenantT } })) as unknown as InjectResult;
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ id: tenantT, timezone: "America/Lima" });
    const evs = await migrator.db.select({ diff: auditEvents.diff }).from(auditEvents).where(and(eq(auditEvents.tenantId, tenantT), eq(auditEvents.action, "tenant.updated")));
    expect(evs.map((e) => e.diff)).toContainEqual({ timezone: { from: "Europe/Madrid", to: "America/Lima" } });
  });

  it("rejects invalid zone, empty body and extra keys with 400; agent gets 403; other tenant untouched", async () => {
    expect((await patch("owner", tenantT, { timezone: "Mars/Olympus" })).statusCode).toBe(400);
    expect((await patch("owner", tenantT, {})).statusCode).toBe(400);
    expect((await patch("owner", tenantT, { timezone: "America/Lima", id: "x" })).statusCode).toBe(400);
    expect((await patch("agent", tenantT, { timezone: "America/Bogota" })).statusCode).toBe(403);
    await patch("owner", tenantRival, { timezone: "Asia/Tokyo" });
    const [row] = await migrator.db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantRival));
    expect(row?.tz).toBe("Europe/Madrid");
  });
});
