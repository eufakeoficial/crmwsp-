import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LoggerService } from "@nestjs/common";
import { auditEvents, channelConnections, createDb, eq, inArray, memberships, tenantPlans, tenants, users, type DbHandle } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { ChannelsController, type GupshupCredentialVerifier } from "../channels/channels.controller.js";

const APP_URL = process.env["DATABASE_URL"];
const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
const REDIS_URL = process.env["REDIS_URL"];
const hasEnv = Boolean(APP_URL && MIGRATOR_URL && REDIS_URL);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json(): unknown;
}

/** Captures every Nest log line so the test can assert the key/password never reach the logs. */
class CaptureLogger implements LoggerService {
  readonly lines: string[] = [];
  private push(args: unknown[]) {
    this.lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  }
  log(...a: unknown[]) { this.push(a); }
  error(...a: unknown[]) { this.push(a); }
  warn(...a: unknown[]) { this.push(a); }
  debug(...a: unknown[]) { this.push(a); }
  verbose(...a: unknown[]) { this.push(a); }
  fatal(...a: unknown[]) { this.push(a); }
}

describe.skipIf(!hasEnv)("POST /channels/:id/reveal-api-key (e2e)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const logs = new CaptureLogger();
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const API_KEY = `gs-secret-${randomUUID()}`;
  const mk = (k: string) => ({ email: `reveal-${k}-${suffix}@example.test`, name: k, password, tenantName: `R ${k}`, tenantSlug: `reveal-${k}-${suffix}` });
  const accounts = { owner: mk("owner"), admin: mk("admin"), agent: mk("agent"), stranger: mk("stranger") };
  type Who = keyof typeof accounts;
  const cookies = {} as Record<Who, string>;
  const ids = {} as Record<Who, string>;
  const tenantOf = {} as Record<Who, string>;
  let channel = "";
  let foreignChannel = "";

  const reveal = (who: Who, id: string, pw: string, tenant = tenantOf.owner) =>
    app.inject({
      method: "POST",
      url: `/channels/${id}/reveal-api-key`,
      payload: { password: pw },
      headers: { cookie: cookies[who], "x-tenant-id": tenant },
    }) as unknown as Promise<InjectResult>;

  beforeAll(async () => {
    process.env["ENCRYPTION_MASTER_KEY"] = randomBytes(32).toString("base64");
    process.env["ENCRYPTION_MASTER_KEY_ID"] = "1";
    process.env["PUBLIC_API_URL"] = "https://api.example.test/";
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: logs });
    (app.get(ChannelsController) as unknown as { verifyGupshup: GupshupCredentialVerifier }).verifyGupshup = async () => ({ status: "valid" });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    for (const k of Object.keys(accounts) as Who[]) {
      const res = (await app.inject({ method: "POST", url: "/auth/signup", payload: accounts[k] })) as unknown as InjectResult;
      expect(res.statusCode).toBe(201);
      cookies[k] = String(res.headers["set-cookie"]).split(";")[0] ?? "";
      tenantOf[k] = (res.json() as { tenants: { id: string }[] }).tenants[0]!.id;
      ids[k] = (await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, accounts[k].email)))[0]!.id;
    }
    await migrator.db.update(users).set({ emailVerifiedAt: new Date() }).where(inArray(users.id, Object.values(ids)));
    await migrator.db.insert(memberships).values([
      { tenantId: tenantOf.owner, userId: ids.admin, role: "admin" },
      { tenantId: tenantOf.owner, userId: ids.agent, role: "agent" },
    ]);
    await migrator.db.update(tenantPlans).set({ setupEndsAt: null }).where(inArray(tenantPlans.tenantId, [tenantOf.owner, tenantOf.stranger]));

    // Real encryption path: the owner connects the channel through the API.
    const created = (await app.inject({
      method: "POST",
      url: "/channels/gupshup",
      headers: { cookie: cookies.owner, "x-tenant-id": tenantOf.owner },
      payload: { phoneE164: `+3460${String(Date.now()).slice(-7)}`, appName: `RevealApp${suffix}`, apiKey: API_KEY },
    })) as unknown as InjectResult;
    expect(created.statusCode).toBe(201);
    channel = (created.json() as { id: string }).id;
    const [fc] = await migrator.db
      .insert(channelConnections)
      .values({ tenantId: tenantOf.stranger, provider: "gupshup", phoneE164: `+3461${String(Date.now()).slice(-7)}`, status: "active", webhookToken: randomUUID() })
      .returning({ id: channelConnections.id });
    foreignChannel = fc!.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((a) => a.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((a) => a.email)));
      await migrator.close();
    }
  });

  it("admin and agent get 403", async () => {
    expect((await reveal("admin", channel, password)).statusCode).toBe(403);
    expect((await reveal("agent", channel, password)).statusCode).toBe(403);
  });

  it("another tenant's channel is 404", async () => {
    expect((await reveal("owner", foreignChannel, password)).statusCode).toBe(404);
  });

  it("owner with the right password gets the key with no-store, audited without the key", async () => {
    const res = await reveal("owner", channel, password);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ apiKey: API_KEY, expiresInSeconds: 30 });
    expect(String(res.headers["cache-control"])).toContain("no-store");
    const rows = await migrator.db.select().from(auditEvents).where(eq(auditEvents.entityId, channel));
    const revealed = rows.filter((r) => r.action === "channel.api_key_revealed");
    expect(revealed).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(API_KEY);
    expect(JSON.stringify(rows)).not.toContain(password);
  });

  it("wrong password is 403 with a generic message and an audited failure", async () => {
    const res = await reveal("owner", channel, "wrong-password-1");
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(API_KEY);
    const rows = await migrator.db.select().from(auditEvents).where(eq(auditEvents.entityId, channel));
    const failed = rows.filter((r) => r.action === "channel.api_key_reveal_failed");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(failed)).not.toContain("wrong-password-1");
  });

  it("the 6th attempt in the hour (successes and failures count) is 429", async () => {
    // 2 attempts already used above (1 ok + 1 wrong); 3 more fill the window.
    for (const pw of [password, "nope-1", password]) await reveal("owner", channel, pw);
    const res = await reveal("owner", channel, password);
    expect(res.statusCode).toBe(429);
    expect(res.body).not.toContain(API_KEY);
  });

  it("logs never contain the key or the password", () => {
    const all = logs.lines.join("\n");
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain("wrong-password-1");
    expect(all).not.toContain(password);
  });
});
