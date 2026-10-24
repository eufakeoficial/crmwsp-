import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  channelConnections,
  contacts,
  conversations,
  createDb,
  eq,
  inArray,
  memberships,
  messages,
  tenantPlans,
  tenants,
  users,
  type DbHandle,
} from "@crmwsp/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
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
  body: string;
}
type Method = "GET" | "POST" | "PATCH";

const sessionCookieOf = (res: InjectResult): string => {
  const raw = res.headers["set-cookie"];
  const line = (Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "";
  return line.split(";")[0] ?? "";
};

describe.skipIf(!hasEnv)("write authorization: deny-by-default and inbox permissions (e2e)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  let outboundQueue: Queue;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const queueName = `outbound-authz-${suffix}`;
  const mk = (k: string) => ({
    email: `authz-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password,
    tenantName: `Tenant ${k}`,
    tenantSlug: `authz-${k}-${suffix}`,
  });
  // owner: owner of tenant T; agent/other/viewer/admin are added to T as members.
  const accounts = { owner: mk("owner"), agent: mk("agent"), other: mk("other"), viewer: mk("viewer"), admin: mk("admin") };
  const cookies = {} as Record<keyof typeof accounts, string>;
  const ids = {} as Record<keyof typeof accounts, string>;
  let tenantT = "";
  let channel = "";
  let convOther = ""; // assigned to `other` (invisible to `agent` with visibility=own)
  let convMine = ""; // assigned to `agent`
  let inboundOther = "";
  let inboundMine = "";

  const as = (who: keyof typeof accounts, method: Method, url: string, payload?: unknown, headers?: Record<string, string>) =>
    app.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      headers: { cookie: cookies[who], "x-tenant-id": tenantT, ...(headers ?? {}) },
    }) as unknown as Promise<InjectResult>;

  async function seedConversation(phone: string, assignee: string): Promise<{ conv: string; inbound: string }> {
    const [c] = await migrator.db.insert(contacts).values({ tenantId: tenantT, phoneE164: phone, name: phone }).returning({ id: contacts.id });
    const [conv] = await migrator.db
      .insert(conversations)
      .values({ tenantId: tenantT, contactId: c!.id, channelConnectionId: channel, lastMessageAt: new Date(), lastInboundAt: new Date(), assignedUserId: assignee })
      .returning({ id: conversations.id });
    const [m] = await migrator.db
      .insert(messages)
      .values({ tenantId: tenantT, conversationId: conv!.id, direction: "inbound", type: "text", body: "hola", status: "received", author: "contact" })
      .returning({ id: messages.id });
    return { conv: conv!.id, inbound: m!.id };
  }

  const lockOf = async (id: string) =>
    (await migrator.db.select({ v: conversations.lockVersion }).from(conversations).where(eq(conversations.id, id)))[0]!.v;

  beforeAll(async () => {
    process.env["ENCRYPTION_MASTER_KEY"] = randomBytes(32).toString("base64");
    process.env["ENCRYPTION_MASTER_KEY_ID"] = "1";
    process.env["PUBLIC_API_URL"] = "https://api.example.test/";
    process.env["OUTBOUND_QUEUE_NAME"] = queueName;
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    outboundQueue = new Queue(queueName, { connection: new Redis(REDIS_URL as string, { maxRetriesPerRequest: null }) });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    for (const k of Object.keys(accounts) as (keyof typeof accounts)[]) {
      const res = (await app.inject({ method: "POST", url: "/auth/signup", payload: accounts[k] })) as unknown as InjectResult;
      expect(res.statusCode).toBe(201);
      cookies[k] = sessionCookieOf(res);
      if (k === "owner") tenantT = (res.json() as { tenants: { id: string }[] }).tenants[0]!.id;
      ids[k] = (await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, accounts[k].email)))[0]!.id;
    }
    await migrator.db.insert(memberships).values([
      { tenantId: tenantT, userId: ids.agent, role: "agent" },
      { tenantId: tenantT, userId: ids.other, role: "agent" },
      { tenantId: tenantT, userId: ids.viewer, role: "viewer" },
      { tenantId: tenantT, userId: ids.admin, role: "admin" },
    ]);
    // Signup leaves a new tenant in setup (ADR 0015); grandfather the test tenants so writes are not
    // answered with SETUP_REQUIRED.
    await migrator.db.update(tenantPlans).set({ setupEndsAt: null }).where(inArray(tenantPlans.tenantId, [tenantT]));
    const [t] = await migrator.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantT));
    await migrator.db
      .update(tenants)
      .set({ settings: { ...(t!.settings ?? {}), inbox: { visibility: "own" } } })
      .where(eq(tenants.id, tenantT));
    const [ch] = await migrator.db
      .insert(channelConnections)
      .values({ tenantId: tenantT, provider: "gupshup", phoneE164: `+3469${suffix.replace(/\D/g, "1").slice(0, 7).padEnd(7, "1")}`, status: "active", webhookToken: randomUUID() })
      .returning({ id: channelConnections.id });
    channel = ch!.id;
    ({ conv: convOther, inbound: inboundOther } = await seedConversation("+34611000001", ids.other));
    ({ conv: convMine, inbound: inboundMine } = await seedConversation("+34611000002", ids.agent));
  });

  afterAll(async () => {
    if (app) await app.close();
    await outboundQueue?.obliterate({ force: true }).catch(() => undefined);
    await outboundQueue?.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((a) => a.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((a) => a.email)));
      await migrator.close();
    }
  });

  it("viewer gets 403 on every mutating conversation route and on improve-text", async () => {
    const id = convMine;
    const results = [
      await as("viewer", "PATCH", `/conversations/${id}`, { status: "resolved", lockVersion: await lockOf(id) }),
      await as("viewer", "POST", `/conversations/${id}/messages`, { text: "hi", clientMessageId: randomUUID() }),
      await as("viewer", "POST", `/conversations/${id}/template-messages`, { templateId: randomUUID(), params: [], clientMessageId: randomUUID() }),
      await as("viewer", "POST", `/conversations/${id}/messages/${inboundMine}/reaction`, { emoji: "👍" }),
      await as("viewer", "POST", `/conversations/${id}/read`),
      await as("viewer", "POST", "/ai/improve-text", { text: "hola", style: "friendly" }),
    ];
    expect(results.map((r) => r.statusCode)).toEqual([403, 403, 403, 403, 403, 403]);
  });

  it("viewer can still read (GET) and mark its own notifications read", async () => {
    expect((await as("viewer", "GET", "/conversations")).statusCode).toBe(200);
    expect((await as("viewer", "POST", "/notifications/read", { all: true })).statusCode).toBe(200);
  });

  it("agent with visibility=own gets 404 on a conversation assigned to another agent", async () => {
    const id = convOther;
    const results = [
      await as("agent", "PATCH", `/conversations/${id}`, { status: "resolved", lockVersion: await lockOf(id) }),
      await as("agent", "POST", `/conversations/${id}/messages`, { text: "hi", clientMessageId: randomUUID() }),
      await as("agent", "POST", `/conversations/${id}/template-messages`, { templateId: randomUUID(), params: [], clientMessageId: randomUUID() }),
      await as("agent", "POST", `/conversations/${id}/messages/${inboundOther}/reaction`, { emoji: "👍" }),
      await as("agent", "POST", `/conversations/${id}/read`),
    ];
    expect(results.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404]);
    const [row] = await migrator.db.select().from(conversations).where(eq(conversations.id, id));
    expect(row!.status).toBe("open");
    expect(row!.lockVersion).toBe(0);
  });

  it("PATCH rejects a viewer as assignee (400)", async () => {
    const res = await as("owner", "PATCH", `/conversations/${convMine}`, { assignedUserId: ids.viewer, lockVersion: await lockOf(convMine) });
    expect(res.statusCode).toBe(400);
  });

  it("happy paths: agent sends/reacts/reads on its own conversation; admin and owner update", async () => {
    expect((await as("agent", "POST", `/conversations/${convMine}/messages`, { text: "hola", clientMessageId: randomUUID() })).statusCode).toBe(202);
    expect((await as("agent", "POST", `/conversations/${convMine}/messages/${inboundMine}/reaction`, { emoji: "👍" })).statusCode).toBe(200);
    expect((await as("agent", "POST", `/conversations/${convMine}/read`)).statusCode).toBe(204);
    const byAgent = await as("agent", "PATCH", `/conversations/${convMine}`, { aiMode: "off", lockVersion: await lockOf(convMine) });
    expect(byAgent.statusCode).toBe(200);
    const byAdmin = await as("admin", "PATCH", `/conversations/${convOther}`, { status: "pending", lockVersion: await lockOf(convOther) });
    expect(byAdmin.statusCode).toBe(200);
    const byOwner = await as("owner", "PATCH", `/conversations/${convOther}`, { assignedUserId: ids.agent, lockVersion: await lockOf(convOther) });
    expect(byOwner.statusCode).toBe(200);
  });
});
