import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createCipherBox, loadMasterKeysFromEnv } from "@crmwsp/crypto";
import { auditEvents, channelConnections, contacts, conversations, createDb, eq, inArray, messages, tenants, users, type DbHandle } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module.js";
import { GUPSHUP_VERIFIER } from "../channels/channels.constants.js";

const hasEnv = Boolean(process.env["DATABASE_URL"] && process.env["DATABASE_URL_MIGRATOR"] && process.env["REDIS_URL"]);

describe.skipIf(!hasEnv)("channel credentials edit and health (e2e)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const mk = (k: string) => ({
    email: `chh-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password: "correct-horse-battery",
    tenantName: `CH ${k}`,
    tenantSlug: `chh-${k}-${suffix}`,
  });
  const accounts = { a: mk("a"), b: mk("b") };
  const s = {} as { cookieA: string; tenantA: string; cookieB: string; tenantB: string; channelA: string; webhookUrl: string; channelB: string };
  const OLD_KEY = `old-key-${randomUUID()}`;
  const NEW_KEY = `new-key-${randomUUID()}`;
  let verifyCalls: Array<[string, string]> = [];
  let verdict: "valid" | "invalid_credentials" = "valid";

  const call = (method: "GET" | "POST" | "PATCH", url: string, who: "a" | "b", payload?: unknown) =>
    app.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      headers: { cookie: who === "a" ? s.cookieA : s.cookieB, "x-tenant-id": who === "a" ? s.tenantA : s.tenantB },
    });

  async function signup(acc: ReturnType<typeof mk>): Promise<{ cookie: string; tenant: string }> {
    const res = await app.inject({ method: "POST", url: "/auth/signup", payload: acc });
    expect(res.statusCode).toBe(201);
    await migrator.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, acc.email));
    return { cookie: String(res.headers["set-cookie"]).split(";")[0] ?? "", tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id };
  }

  beforeAll(async () => {
    process.env["ENCRYPTION_MASTER_KEY"] = randomBytes(32).toString("base64");
    process.env["ENCRYPTION_MASTER_KEY_ID"] = "1";
    process.env["PUBLIC_API_URL"] = "https://api.example.test/";
    migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 2 });
    // Never reach the real Gupshup API from tests.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GUPSHUP_VERIFIER)
      .useValue(async (apiKey: string, appName: string) => {
        verifyCalls.push([apiKey, appName]);
        return { status: verdict };
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    Object.assign(s, { cookieA: a.cookie, tenantA: a.tenant, cookieB: b.cookie, tenantB: b.tenant });
    const created = await call("POST", "/channels/gupshup", "a", { phoneE164: "+34600000301", appName: "AppOne", apiKey: OLD_KEY });
    expect(created.statusCode).toBe(201);
    s.channelA = (created.json() as { id: string }).id;
    s.webhookUrl = (created.json() as { webhookUrl: string }).webhookUrl;
    const createdB = await call("POST", "/channels/gupshup", "b", { phoneE164: "+34600000302", appName: "AppB", apiKey: `${OLD_KEY}-b` });
    expect(createdB.statusCode).toBe(201);
    s.channelB = (createdB.json() as { id: string }).id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((a) => a.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((a) => a.email)));
      await migrator.close();
    }
  });

  it("PATCH /channels/:id/credentials: a rejected key changes nothing", async () => {
    verdict = "invalid_credentials";
    const res = await call("PATCH", `/channels/${s.channelA}/credentials`, "a", { appName: "AppTwo", apiKey: NEW_KEY });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(NEW_KEY);
    const [row] = await migrator.db.select().from(channelConnections).where(eq(channelConnections.id, s.channelA));
    expect(row!.externalAppId).toBe("AppOne");
    verdict = "valid";
  });

  it("PATCH /channels/:id/credentials: replaces key and app in place, keeps the webhook, audits without the key", async () => {
    verifyCalls = [];
    const res = await call("PATCH", `/channels/${s.channelA}/credentials`, "a", { appName: "AppTwo", apiKey: NEW_KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(NEW_KEY);
    expect(res.json()).toMatchObject({ appName: "AppTwo", webhookUrl: s.webhookUrl, apiKeyHint: `••••${NEW_KEY.slice(-4)}` });
    expect(verifyCalls).toEqual([[NEW_KEY, "AppTwo"]]);
    const [row] = await migrator.db.select().from(channelConnections).where(eq(channelConnections.id, s.channelA));
    const box = createCipherBox(loadMasterKeysFromEnv(process.env));
    expect(box.decrypt(row!.credentialsEncrypted!, { tenantId: s.tenantA, purpose: "gupshup_api_key" })).toBe(NEW_KEY);
    const audit = await migrator.db.select().from(auditEvents).where(eq(auditEvents.entityId, s.channelA));
    const entry = audit.find((e) => e.action === "channel.credentials_updated");
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain(NEW_KEY);
  });

  it("PATCH /channels/:id/credentials: another tenant cannot edit it (404)", async () => {
    const res = await call("PATCH", `/channels/${s.channelA}/credentials`, "b", { appName: "Hijack", apiKey: "hijack-key-1234" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /channels/health: last inbound and last outbound result per channel, isolated per tenant", async () => {
    const emptyA = await call("GET", "/channels/health", "a");
    expect(emptyA.json()).toEqual({ items: [{ channelId: s.channelA, lastInboundAt: null, lastOutbound: null }] });

    const inboundAt = new Date(Date.now() - 5 * 60_000);
    const [contact] = await migrator.db.insert(contacts).values({ tenantId: s.tenantA, phoneE164: "+5491100000001", name: "C" }).returning({ id: contacts.id });
    const [conv] = await migrator.db
      .insert(conversations)
      .values({ tenantId: s.tenantA, contactId: contact!.id, channelConnectionId: s.channelA, lastMessageAt: inboundAt, lastInboundAt: inboundAt })
      .returning({ id: conversations.id });
    const base = { tenantId: s.tenantA, conversationId: conv!.id, direction: "outbound" as const, type: "text" as const, author: "user" as const };
    await migrator.db.insert(messages).values([
      { ...base, body: "ok", status: "delivered", createdAt: new Date(Date.now() - 20 * 60_000) },
      { ...base, body: "queued", status: "queued", createdAt: new Date(Date.now() - 1 * 60_000) },
      { ...base, body: "boom", status: "failed", error: { code: "provider_error", message: "Authentication Failed" }, createdAt: new Date(Date.now() - 10 * 60_000) },
    ]);

    const a = await call("GET", "/channels/health", "a");
    expect(a.statusCode).toBe(200);
    const [item] = (a.json() as { items: Array<{ channelId: string; lastInboundAt: string; lastOutbound: { ok: boolean; error: string | null } }> }).items;
    expect(item!.channelId).toBe(s.channelA);
    expect(new Date(item!.lastInboundAt).getTime()).toBe(inboundAt.getTime());
    // queued is not final: the latest final result is the failure.
    expect(item!.lastOutbound).toMatchObject({ ok: false, error: "Authentication Failed" });

    const b = await call("GET", "/channels/health", "b");
    expect(b.json()).toEqual({ items: [{ channelId: s.channelB, lastInboundAt: null, lastOutbound: null }] });
  });
});
