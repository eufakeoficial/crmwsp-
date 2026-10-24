import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { contactSchema, errorResponseSchema } from "@crmwsp/contracts";
import { createCipherBox, loadMasterKeysFromEnv } from "@crmwsp/crypto";
import {
  attachments,
  auditEvents,
  channelConnections,
  contacts,
  conversations,
  createDb,
  eq,
  inArray,
  memberships,
  messages,
  messageTemplates,
  tenants,
  users,
  type DbHandle,
} from "@crmwsp/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { SSE_MAX_CONNECTIONS_PER_USER } from "../events/events.controller.js";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasEnv)("channels, inbox, outbound and SSE (e2e, real Postgres + Redis)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  let redis: Redis;
  let outboundQueue: Queue;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const queueName = `outbound-test-${suffix}`;
  const API_KEY = `gs-secret-${randomUUID()}`;
  const mk = (k: string) => ({
    email: `inbox-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password,
    tenantName: `Tenant ${k}`,
    tenantSlug: `inbox-${k}-${suffix}`,
  });
  const accounts = { a: mk("a"), b: mk("b"), c: mk("c") };
  const s = {} as {
    cookieA: string;
    cookieB: string;
    cookieC: string;
    tenantA: string;
    tenantB: string;
    tenantC: string;
    userB: string;
    userC: string;
    channelA: string;
    channelB: string;
    webhookUrl: string;
    convA: string[];
    convB: string;
    contactB: string;
  };

  const inject = (opts: {
    method: Method;
    url: string;
    payload?: unknown;
    cookie?: string;
    tenant?: string;
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

  const asA = (method: Method, url: string, payload?: unknown, headers?: Record<string, string>) =>
    inject({ method, url, payload, cookie: s.cookieA, tenant: s.tenantA, ...(headers ? { headers } : {}) });

  async function signup(acc: ReturnType<typeof mk>): Promise<{ cookie: string; tenant: string }> {
    const res = await inject({ method: "POST", url: "/auth/signup", payload: acc });
    expect(res.statusCode).toBe(201);
    // Channel connection requires a verified owner email (0095).
    await migrator.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, acc.email));
    return { cookie: sessionCookieOf(res), tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id };
  }

  async function userId(email: string): Promise<string> {
    const [u] = await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return u!.id;
  }

  async function seedConversation(
    tenantId: string,
    channelId: string,
    phone: string,
    lastMessageAt: Date,
    lastInboundAt: Date | null = lastMessageAt,
  ): Promise<{ conversationId: string; contactId: string }> {
    const [c] = await migrator.db
      .insert(contacts)
      .values({ tenantId, phoneE164: phone, name: `Contact ${phone}` })
      .returning({ id: contacts.id });
    const [conv] = await migrator.db
      .insert(conversations)
      .values({ tenantId, contactId: c!.id, channelConnectionId: channelId, lastMessageAt, lastInboundAt })
      .returning({ id: conversations.id });
    return { conversationId: conv!.id, contactId: c!.id };
  }

  beforeAll(async () => {
    // Test-only master key (same as `openssl rand -base64 32`), never written to files.
    process.env["ENCRYPTION_MASTER_KEY"] = randomBytes(32).toString("base64");
    process.env["ENCRYPTION_MASTER_KEY_ID"] = "1";
    process.env["PUBLIC_API_URL"] = "https://api.example.test/";
    process.env["OUTBOUND_QUEUE_NAME"] = queueName;
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    redis = new Redis(REDIS_URL as string);
    outboundQueue = new Queue(queueName, { connection: new Redis(REDIS_URL as string, { maxRetriesPerRequest: null }) });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    const c = await signup(accounts.c);
    Object.assign(s, {
      cookieA: a.cookie,
      tenantA: a.tenant,
      cookieB: b.cookie,
      tenantB: b.tenant,
      cookieC: c.cookie,
      tenantC: c.tenant,
      userB: await userId(accounts.b.email),
      userC: await userId(accounts.c.email),
    });
    // C is also an agent of tenant A.
    await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: s.userC, role: "agent" });
  });

  afterAll(async () => {
    if (app) await app.close();
    await outboundQueue?.obliterate({ force: true }).catch(() => undefined);
    await outboundQueue?.close();
    redis?.disconnect();
    if (migrator) {
      const slugs = Object.values(accounts).map((a) => a.tenantSlug);
      await migrator.db.delete(tenants).where(inArray(tenants.slug, slugs));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((a) => a.email)));
      await migrator.close();
    }
  });

  // ---------------------------------------------------------------- channels

  describe("channels", () => {
    it("creates a Gupshup channel whose webhookUrl works against the webhook endpoint", async () => {
      const res = await asA("POST", "/channels/gupshup", { phoneE164: "+34600000101", appName: "DemoApp", apiKey: API_KEY });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; status: string; webhookUrl: string; apiKeyHint: string; phoneE164: string };
      expect(body).toMatchObject({ phoneE164: "+34600000101", status: "active", apiKeyHint: `••••${API_KEY.slice(-4)}` });
      expect(body.webhookUrl).toMatch(/^https:\/\/api\.example\.test\/webhooks\/gupshup\/[A-Za-z0-9_-]{43}$/);
      expect(res.body).not.toContain(API_KEY);
      s.channelA = body.id;
      s.webhookUrl = body.webhookUrl;

      const path = new URL(body.webhookUrl).pathname;
      const userEvent = { app: "DemoApp", timestamp: 1729339200000, version: 2, type: "user-event", payload: { phone: "5491155551234", type: "opted-in" } };
      expect((await inject({ method: "POST", url: path, payload: userEvent })).statusCode).toBe(200);
      expect((await inject({ method: "POST", url: `/webhooks/gupshup/${"x".repeat(43)}`, payload: userEvent })).statusCode).toBe(401);

      const resB = await inject({
        method: "POST",
        url: "/channels/gupshup",
        cookie: s.cookieB,
        tenant: s.tenantB,
        payload: { phoneE164: "+34600000101", appName: "OtherApp", apiKey: `${API_KEY}-b` },
      });
      expect(resB.statusCode).toBe(201);
      s.channelB = (resB.json() as { id: string }).id;
    });

    it("never returns the apiKey; webhookUrl only for owner/admin; agents cannot create (403)", async () => {
      const list = await asA("GET", "/channels");
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toContain(API_KEY);
      const items = (list.json() as { items: { id: string; webhookUrl: string | null }[] }).items;
      expect(items.map((i) => i.id)).toEqual([s.channelA]);
      expect(items[0]!.webhookUrl).toBe(s.webhookUrl);

      const asAgent = await inject({ method: "GET", url: "/channels", cookie: s.cookieC, tenant: s.tenantA });
      expect(asAgent.statusCode).toBe(200);
      const agentItems = (asAgent.json() as { items: { webhookUrl: string | null; apiKeyHint: string | null }[] }).items;
      expect(agentItems[0]).toMatchObject({ webhookUrl: null, apiKeyHint: null });

      const create = await inject({
        method: "POST",
        url: "/channels/gupshup",
        cookie: s.cookieC,
        tenant: s.tenantA,
        payload: { phoneE164: "+34600000999", appName: "X", apiKey: "agent-key-123" },
      });
      expect(create.statusCode).toBe(403);
      const patch = await inject({ method: "PATCH", url: `/channels/${s.channelA}`, cookie: s.cookieC, tenant: s.tenantA, payload: { status: "disabled" } });
      expect(patch.statusCode).toBe(403);
    });

    it("stores the key encrypted, bound to the tenant (AAD): it does not decrypt with another tenantId", async () => {
      const [row] = await migrator.db.select().from(channelConnections).where(eq(channelConnections.id, s.channelA));
      const blob = row!.credentialsEncrypted!;
      expect(blob.toString("utf8")).not.toContain(API_KEY);
      const box = createCipherBox(loadMasterKeysFromEnv(process.env));
      expect(box.decrypt(blob, { tenantId: s.tenantA, purpose: "gupshup_api_key" })).toBe(API_KEY);
      expect(() => box.decrypt(blob, { tenantId: s.tenantB, purpose: "gupshup_api_key" })).toThrow(/Unable to decrypt/);
    });

    it("rotating the webhook token invalidates the old URL; disabling the channel stops the webhook", async () => {
      const oldPath = new URL(s.webhookUrl).pathname;
      const res = await asA("POST", `/channels/${s.channelA}/rotate-webhook-token`);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(API_KEY);
      const newUrl = (res.json() as { webhookUrl: string }).webhookUrl;
      expect(newUrl).not.toBe(s.webhookUrl);
      const ev = { app: "DemoApp", timestamp: 1, version: 2, type: "user-event", payload: { phone: "1", type: "opted-in" } };
      expect((await inject({ method: "POST", url: oldPath, payload: ev })).statusCode).toBe(401);
      expect((await inject({ method: "POST", url: new URL(newUrl).pathname, payload: ev })).statusCode).toBe(200);

      const dis = await asA("PATCH", `/channels/${s.channelA}`, { status: "disabled" });
      expect(dis.statusCode).toBe(200);
      expect((dis.json() as { status: string }).status).toBe("disabled");
      expect((await inject({ method: "POST", url: new URL(newUrl).pathname, payload: ev })).statusCode).toBe(401);
      expect((await asA("PATCH", `/channels/${s.channelA}`, { status: "active" })).statusCode).toBe(200);
      // A cannot touch B's channel.
      expect((await asA("PATCH", `/channels/${s.channelB}`, { status: "disabled" })).statusCode).toBe(404);

      const audit = await migrator.db.select().from(auditEvents).where(eq(auditEvents.entityId, s.channelA));
      expect(audit.map((a) => a.action).sort()).toEqual(
        ["channel.created", "channel.status_changed", "channel.status_changed", "channel.webhook_token_rotated"].sort(),
      );
      expect(JSON.stringify(audit)).not.toContain(API_KEY);
    });
  });

  // ---------------------------------------------------------------- inbox

  describe("inbox", () => {
    beforeAll(async () => {
      const base = Date.now() - 60 * 60 * 1000;
      s.convA = [];
      const tie = new Date(base + 30_000);
      // Two conversations share the same activity timestamp: pagination must break ties by id.
      const times = [new Date(base + 10_000), new Date(base + 20_000), tie, tie, new Date(base + 40_000)];
      for (const [i, t] of times.entries()) {
        const { conversationId } = await seedConversation(s.tenantA, s.channelA, `+3460010000${i}`, t);
        s.convA.push(conversationId);
      }
      const b = await seedConversation(s.tenantB, s.channelB, "+34600200000", new Date());
      s.convB = b.conversationId;
      s.contactB = b.contactId;
      // Two inbound messages (one with an attachment) on the newest A conversation.
      const newest = s.convA[4]!;
      const [m1] = await migrator.db
        .insert(messages)
        .values({ tenantId: s.tenantA, conversationId: newest, direction: "inbound", type: "text", body: "x".repeat(300), status: "received", author: "contact", createdAt: new Date(base) })
        .returning({ id: messages.id });
      const [m2] = await migrator.db
        .insert(messages)
        .values({ tenantId: s.tenantA, conversationId: newest, direction: "inbound", type: "image", body: "Foto", status: "received", author: "contact", createdAt: new Date(base + 1000) })
        .returning({ id: messages.id });
      await migrator.db.insert(attachments).values({ tenantId: s.tenantA, messageId: m2!.id, mimeType: "image/jpeg" });
      expect(m1).toBeDefined();
    });

    it("contacts expose tags and extracted, validated by contactSchema", async () => {
      const { conversationId, contactId } = await seedConversation(s.tenantA, s.channelA, "+34600777001", new Date());
      const extracted = { city: { value: "Madrid", confidence: 0.9, sourceMessageId: randomUUID() } };
      await migrator.db.update(contacts).set({ extracted, tags: ["vip"] }).where(eq(contacts.id, contactId));
      const detail = contactSchema.parse((await asA("GET", `/contacts/${contactId}`)).json());
      expect(detail.tags).toEqual(["vip"]);
      expect(detail.extracted).toEqual(extracted);
      const list = (await asA("GET", "/contacts?q=%2B34600777001")).json() as { items: unknown[] };
      expect(list.items.map((i) => contactSchema.parse(i).extracted)).toEqual([extracted]);
      // Remove the extra rows so other tests' counts for tenant A stay intact.
      await migrator.db.delete(conversations).where(eq(conversations.id, conversationId));
      await migrator.db.delete(contacts).where(eq(contacts.id, contactId));
    });

    it("isolation: A never sees B's conversations, messages or contacts (404 by id)", async () => {
      const list = await asA("GET", "/conversations?limit=100");
      expect(list.statusCode).toBe(200);
      const ids = (list.json() as { items: { id: string }[] }).items.map((i) => i.id);
      expect(ids.sort()).toEqual([...s.convA].sort());
      expect((await asA("GET", `/conversations/${s.convB}`)).statusCode).toBe(404);
      expect((await asA("GET", `/conversations/${s.convB}/messages`)).statusCode).toBe(404);
      expect((await asA("POST", `/conversations/${s.convB}/read`)).statusCode).toBe(404);
      expect((await asA("PATCH", `/conversations/${s.convB}`, { status: "resolved", lockVersion: 0 })).statusCode).toBe(404);
      expect((await asA("POST", `/conversations/${s.convB}/messages`, { text: "hi", clientMessageId: randomUUID() })).statusCode).toBe(404);
      expect((await asA("GET", `/contacts/${s.contactB}`)).statusCode).toBe(404);
      const contactsA = await asA("GET", "/contacts?q=%2B3460");
      expect((contactsA.json() as { items: { id: string }[] }).items.map((c) => c.id)).not.toContain(s.contactB);
      expect((contactsA.json() as { items: unknown[] }).items).toHaveLength(5);
      // B with A's tenant header: 403.
      expect((await inject({ method: "GET", url: "/conversations", cookie: s.cookieB, tenant: s.tenantA })).statusCode).toBe(403);
    });

    it("rejects forged or malformed cursors with 400", async () => {
      const forged = Buffer.from(JSON.stringify({ t: "1); drop table messages;--", id: randomUUID() })).toString("base64url");
      const extra = Buffer.from(JSON.stringify({ t: "1", id: randomUUID(), x: 1 })).toString("base64url");
      for (const c of [forged, extra, "not-base64!!", Buffer.from("[]").toString("base64url")]) {
        expect((await asA("GET", `/conversations?cursor=${encodeURIComponent(c)}`)).statusCode).toBe(400);
        expect((await asA("GET", `/conversations/${s.convA[0]}/messages?before=${encodeURIComponent(c)}`)).statusCode).toBe(400);
      }
    });

    it("keyset pagination is stable (ties broken by id, no gaps or duplicates)", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await asA("GET", `/conversations?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: { id: string }[]; nextCursor: string | null };
        seen.push(...body.items.map((i) => i.id));
        cursor = body.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(5);
      const full = (await asA("GET", "/conversations?limit=100")).json() as { items: { id: string }[] };
      expect(seen).toEqual(full.items.map((i) => i.id));
      expect(seen[0]).toBe(s.convA[4]);
      expect((await asA("GET", "/conversations?cursor=garbage")).statusCode).toBe(400);
    });

    it("unreadCount, preview and read", async () => {
      const id = s.convA[4]!;
      let conv = (await asA("GET", `/conversations/${id}`)).json() as {
        unreadCount: number;
        lastMessage: { preview: string; type: string };
        contact: { phoneE164: string };
      };
      expect(conv.unreadCount).toBe(2);
      expect(conv.lastMessage.type).toBe("image");
      expect(conv.contact.phoneE164).toBe("+34600100004");
      expect((await asA("POST", `/conversations/${id}/read`)).statusCode).toBe(204);
      conv = (await asA("GET", `/conversations/${id}`)).json() as typeof conv;
      expect(conv.unreadCount).toBe(0);
      await sleep(5);
      await migrator.db.insert(messages).values({ tenantId: s.tenantA, conversationId: id, direction: "inbound", type: "text", body: "y".repeat(200), status: "received", author: "contact" });
      conv = (await asA("GET", `/conversations/${id}`)).json() as typeof conv;
      expect(conv.unreadCount).toBe(1);
      expect(conv.lastMessage.preview).toHaveLength(120);
    });

    it("lists messages backwards with attachments", async () => {
      const id = s.convA[4]!;
      const p1 = (await asA("GET", `/conversations/${id}/messages?limit=2`)).json() as {
        items: { id: string; type: string; attachments: { mimeType: string }[] }[];
        nextCursor: string | null;
      };
      expect(p1.items).toHaveLength(2);
      expect(p1.items[1]!.attachments).toEqual([expect.objectContaining({ mimeType: "image/jpeg" })]);
      const p2 = (await asA("GET", `/conversations/${id}/messages?limit=2&before=${p1.nextCursor}`)).json() as typeof p1;
      expect(p2.items).toHaveLength(1);
      expect(p2.nextCursor).toBeNull();
    });

    it("PATCH uses optimistic locking (409 on stale lockVersion) and audits", async () => {
      const id = s.convA[0]!;
      const ok = await asA("PATCH", `/conversations/${id}`, { status: "pending", lockVersion: 0 });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ status: "pending", lockVersion: 1 });
      const stale = await asA("PATCH", `/conversations/${id}`, { status: "open", lockVersion: 0 });
      expect(stale.statusCode).toBe(409);
      const viaHeader = await asA("PATCH", `/conversations/${id}`, { aiMode: "assist" }, { "if-match": '"1"' });
      expect(viaHeader.statusCode).toBe(200);
      expect(viaHeader.json()).toMatchObject({ aiMode: "assist", lockVersion: 2 });
      expect((await asA("PATCH", `/conversations/${id}`, { aiMode: "off" })).statusCode).toBe(400);
      const audit = await migrator.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
      expect(audit).toHaveLength(2);
    });

    it("assignee must be a member of the tenant", async () => {
      const id = s.convA[1]!;
      const foreign = await asA("PATCH", `/conversations/${id}`, { assignedUserId: s.userB, lockVersion: 0 });
      expect(foreign.statusCode).toBe(400);
      const ok = await asA("PATCH", `/conversations/${id}`, { assignedUserId: s.userC, lockVersion: 0 });
      expect(ok.statusCode).toBe(200);
      expect((ok.json() as { assignee: { id: string } }).assignee.id).toBe(s.userC);
      const mine = (await inject({ method: "GET", url: "/conversations?assignedTo=me", cookie: s.cookieC, tenant: s.tenantA })).json() as { items: { id: string }[] };
      expect(mine.items.map((i) => i.id)).toEqual([id]);
      const byId = (await asA("GET", `/conversations?assignedTo=${s.userC}`)).json() as { items: { id: string }[] };
      expect(byId.items.map((i) => i.id)).toEqual([id]);
      const unassigned = (await asA("GET", "/conversations?assignedTo=unassigned&limit=100")).json() as { items: unknown[] };
      expect(unassigned.items).toHaveLength(4);
    });
  });

  // ---------------------------------------------------------------- outbound

  describe("outbound send", () => {
    it("outside the 24 h window answers 422 OUTSIDE_SERVICE_WINDOW", async () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const { conversationId } = await seedConversation(s.tenantA, s.channelA, "+34600300000", old, old);
      const res = await asA("POST", `/conversations/${conversationId}/messages`, { text: "Hola", clientMessageId: randomUUID() });
      expect(res.statusCode).toBe(422);
      expect(errorResponseSchema.parse(res.json()).code).toBe("OUTSIDE_SERVICE_WINDOW");
      const rows = await migrator.db.select().from(messages).where(eq(messages.conversationId, conversationId));
      expect(rows).toHaveLength(0);
    });

    it("same clientMessageId twice creates a single queued message and one job", async () => {
      const id = s.convA[2]!;
      const clientMessageId = randomUUID();
      const r1 = await asA("POST", `/conversations/${id}/messages`, { text: "Presupuesto enviado", clientMessageId });
      const r2 = await asA("POST", `/conversations/${id}/messages`, { text: "Presupuesto enviado", clientMessageId });
      expect(r1.statusCode).toBe(202);
      expect(r2.statusCode).toBe(202);
      const m1 = r1.json() as { id: string; status: string; direction: string; author: string; authorUserId: string };
      expect(m1).toMatchObject({ status: "queued", direction: "outbound", author: "user" });
      expect((r2.json() as { id: string }).id).toBe(m1.id);
      const rows = await migrator.db.select().from(messages).where(eq(messages.clientMessageId, clientMessageId));
      expect(rows).toHaveLength(1);
      const job = await outboundQueue.getJob(m1.id);
      expect(job?.name).toBe("send-message");
      expect(job?.data).toEqual({ tenantId: s.tenantA, messageId: m1.id });
      expect(JSON.stringify(job?.data)).not.toContain("Presupuesto");
      // The conversation moved to the top of the inbox.
      const top = (await asA("GET", "/conversations?limit=1")).json() as { items: { id: string }[] };
      expect(top.items[0]!.id).toBe(id);
      // Concurrent duplicates: still one message and one job.
      const concurrentId = randomUUID();
      const both = await Promise.all([
        asA("POST", `/conversations/${id}/messages`, { text: "Concurrente", clientMessageId: concurrentId }),
        asA("POST", `/conversations/${id}/messages`, { text: "Concurrente", clientMessageId: concurrentId }),
      ]);
      expect(both.map((r) => r.statusCode)).toEqual([202, 202]);
      const ids = both.map((r) => (r.json() as { id: string }).id);
      expect(ids[0]).toBe(ids[1]);
      expect(await migrator.db.select().from(messages).where(eq(messages.clientMessageId, concurrentId))).toHaveLength(1);
      const jobs = (await outboundQueue.getJobs(["waiting", "delayed", "active", "completed", "failed"])).filter(
        (j) => (j.data as { messageId?: string }).messageId === ids[0],
      );
      expect(jobs).toHaveLength(1);
      // Reusing the id on another conversation is a conflict.
      expect((await asA("POST", `/conversations/${s.convA[3]}/messages`, { text: "x", clientMessageId })).statusCode).toBe(409);
    });
  });

  describe("template send", () => {
    async function seedTemplate(status: "approved" | "pending" = "approved"): Promise<string> {
      const [t] = await migrator.db
        .insert(messageTemplates)
        .values({
          tenantId: s.tenantA,
          channelConnectionId: s.channelA,
          name: `reactivar_${randomUUID().slice(0, 8)}`,
          language: "es",
          category: "utility",
          status,
          body: "Hola {{1}}, seguimos con {{2}}?",
          externalId: "gs-tpl-1",
        })
        .returning({ id: messageTemplates.id });
      return t!.id;
    }

    it("answers 400 when params do not match the placeholders, or the template is not approved", async () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const { conversationId } = await seedConversation(s.tenantA, s.channelA, "+34600300001", old, old);
      const templateId = await seedTemplate();
      const url = `/conversations/${conversationId}/template-messages`;
      const mismatch = await asA("POST", url, { templateId, params: ["Ana"], clientMessageId: randomUUID() });
      expect(mismatch.statusCode).toBe(400);
      const pending = await asA("POST", url, { templateId: await seedTemplate("pending"), params: ["Ana", "x"], clientMessageId: randomUUID() });
      expect(pending.statusCode).toBe(400);
      expect(await migrator.db.select().from(messages).where(eq(messages.conversationId, conversationId))).toHaveLength(0);
    });

    it("queues a template message outside the window and enqueues one job without params", async () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const { conversationId } = await seedConversation(s.tenantA, s.channelA, "+34600300002", old, old);
      const templateId = await seedTemplate();
      const res = await asA("POST", `/conversations/${conversationId}/template-messages`, { templateId, params: ["Ana", "la reforma"], clientMessageId: randomUUID() });
      expect(res.statusCode).toBe(202);
      const m = res.json() as { id: string; type: string; status: string; body: string };
      expect(m).toMatchObject({ type: "template", status: "queued", body: "Hola Ana, seguimos con la reforma?" });
      const [row] = await migrator.db.select().from(messages).where(eq(messages.id, m.id));
      expect(row).toMatchObject({ templateId, templateParams: ["Ana", "la reforma"] });
      const job = await outboundQueue.getJob(m.id);
      expect(job?.data).toEqual({ tenantId: s.tenantA, messageId: m.id });
      // Tenant B cannot use A's conversation.
      const other = await inject({
        method: "POST",
        url: `/conversations/${conversationId}/template-messages`,
        payload: { templateId, params: ["Ana", "x"], clientMessageId: randomUUID() },
        cookie: s.cookieB,
        tenant: s.tenantB,
      });
      expect(other.statusCode).toBe(404);
    });

    it("same clientMessageId twice creates one template message and one job", async () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const { conversationId } = await seedConversation(s.tenantA, s.channelA, "+34600300003", old, old);
      const templateId = await seedTemplate();
      const payload = { templateId, params: ["Ana", "x"], clientMessageId: randomUUID() };
      const url = `/conversations/${conversationId}/template-messages`;
      const r1 = await asA("POST", url, payload);
      const r2 = await asA("POST", url, payload);
      expect([r1.statusCode, r2.statusCode]).toEqual([202, 202]);
      const id = (r1.json() as { id: string }).id;
      expect((r2.json() as { id: string }).id).toBe(id);
      const concurrent = { ...payload, clientMessageId: randomUUID() };
      const both = await Promise.all([asA("POST", url, concurrent), asA("POST", url, concurrent)]);
      expect(both.map((r) => r.statusCode)).toEqual([202, 202]);
      const rows = await migrator.db.select().from(messages).where(eq(messages.conversationId, conversationId));
      expect(rows).toHaveLength(2);
      const jobs = (await outboundQueue.getJobs(["waiting", "delayed", "active", "completed", "failed"])).filter((j) =>
        rows.some((r) => r.id === (j.data as { messageId?: string }).messageId),
      );
      expect(jobs).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------- SSE

  describe("SSE /events", () => {
    interface Stream {
      res: IncomingMessage;
      data: () => string;
      close: () => void;
    }

    function open(port: number, path: string, cookie: string, tenant?: string): Promise<Stream> {
      return new Promise((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port, path, headers: { cookie, ...(tenant ? { "x-tenant-id": tenant } : {}) } },
          (res) => {
            let buf = "";
            res.setEncoding("utf8");
            res.on("data", (c: string) => (buf += c));
            resolve({ res, data: () => buf, close: () => req.destroy() });
          },
        );
        req.on("error", (e) => (e.message.includes("socket hang up") ? undefined : reject(e)));
        req.end();
      });
    }

    async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
      const end = Date.now() + ms;
      while (!fn()) {
        if (Date.now() > end) throw new Error("timeout");
        await sleep(20);
      }
    }

    it("delivers a Redis event only to clients of that tenant and cleans up on disconnect", async () => {
      await app.listen(0, "127.0.0.1");
      const addr = app.getHttpServer().address() as { port: number };
      const hub = app.get(RealtimeHub);

      const a = await open(addr.port, "/events", s.cookieA, s.tenantA);
      const b = await open(addr.port, `/events?tenantId=${s.tenantB}`, s.cookieB);
      expect(a.res.statusCode).toBe(200);
      expect(b.res.statusCode).toBe(200);
      expect(String(a.res.headers["content-type"])).toMatch(/text\/event-stream/);
      await waitFor(() => a.data().includes(": connected") && b.data().includes(": connected"));

      const forbidden = await open(addr.port, `/events?tenantId=${s.tenantA}`, s.cookieB);
      expect(forbidden.res.statusCode).toBe(403);
      forbidden.close();
      const anon = await open(addr.port, `/events?tenantId=${s.tenantA}`, "");
      expect(anon.res.statusCode).toBe(401);
      anon.close();

      const event = { type: "message.received", conversationId: s.convA[0], messageId: randomUUID() };
      await redis.publish(`tenant:${s.tenantA}:events`, JSON.stringify(event));
      await waitFor(() => a.data().includes(event.messageId));
      expect(a.data()).toContain("event: message.received");
      await sleep(200);
      expect(b.data()).not.toContain(event.messageId);

      expect(hub.listenerCount(s.tenantA)).toBe(1);

      // Per-user cap: A already has 1 stream; 4 more fit, the next one is 429.
      const extra: Stream[] = [];
      for (let i = 1; i < SSE_MAX_CONNECTIONS_PER_USER; i++) {
        const x = await open(addr.port, "/events", s.cookieA, s.tenantA);
        expect(x.res.statusCode).toBe(200);
        extra.push(x);
      }
      const over = await open(addr.port, "/events", s.cookieA, s.tenantA);
      expect(over.res.statusCode).toBe(429);
      over.close();
      for (const x of extra) x.close();
      await waitFor(() => hub.listenerCount(s.tenantA) === 1);
      const again = await open(addr.port, "/events", s.cookieA, s.tenantA);
      expect(again.res.statusCode).toBe(200);
      again.close();
      a.close();
      b.close();
      await waitFor(() => hub.listenerCount() === 0);
    });
  });
});
