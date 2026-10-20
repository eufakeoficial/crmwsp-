import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  inboxConversationListResponseSchema,
  inboxCountsSchema,
  type InboxConversation,
  type InboxCounts,
} from "@crmwsp/contracts";
import {
  adAttributions,
  auditEvents,
  channelConnections,
  contacts,
  conversations,
  createDb,
  eq,
  inArray,
  memberships,
  messages,
  tenants,
  users,
  type DbHandle,
} from "@crmwsp/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";

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
type Method = "GET" | "POST" | "PATCH" | "DELETE";

const cookieOf = (res: InjectResult): string => {
  const raw = res.headers["set-cookie"];
  return ((Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "").split(";")[0] ?? "";
};

describe.skipIf(!hasEnv)("inbox v2 (e2e, real Postgres + Redis)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  let outboundQueue: Queue;
  const suffix = randomUUID().slice(0, 8);
  const queueName = `outbound-inbox2-${suffix}`;
  const mk = (k: string) => ({
    email: `inbox2-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password: "correct-horse-battery",
    tenantName: `Tenant ${k}`,
    tenantSlug: `inbox2-${k}-${suffix}`,
  });
  const accounts = { a: mk("a"), b: mk("b"), c: mk("c") };
  const s = {} as {
    cookieA: string;
    cookieB: string;
    cookieC: string;
    tenantA: string;
    tenantB: string;
    userA: string;
    userC: string;
    channelA: string;
    conv1: string;
    conv2: string;
    conv3: string;
    contact1: string;
    contact2: string;
    convB: string;
  };

  const inject = (o: { method: Method; url: string; payload?: unknown; cookie: string; tenant: string }): Promise<InjectResult> =>
    app.inject({
      method: o.method,
      url: o.url,
      ...(o.payload !== undefined ? { payload: o.payload as object } : {}),
      headers: { cookie: o.cookie, "x-tenant-id": o.tenant },
    }) as unknown as Promise<InjectResult>;
  const asA = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieA, tenant: s.tenantA });
  const asC = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieC, tenant: s.tenantA });
  const asB = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieB, tenant: s.tenantB });

  async function signup(acc: ReturnType<typeof mk>): Promise<{ cookie: string; tenant: string }> {
    const res = (await app.inject({ method: "POST", url: "/auth/signup", payload: acc })) as unknown as InjectResult;
    expect(res.statusCode).toBe(201);
    return { cookie: cookieOf(res), tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id };
  }
  const userId = async (email: string) => (await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!.id;

  async function seedConv(tenantId: string, channelId: string, phone: string, name: string, at: Date, tags: string[] = []) {
    const [c] = await migrator.db.insert(contacts).values({ tenantId, phoneE164: phone, name, tags }).returning({ id: contacts.id });
    const [conv] = await migrator.db
      .insert(conversations)
      .values({ tenantId, contactId: c!.id, channelConnectionId: channelId, lastMessageAt: at, lastInboundAt: at })
      .returning({ id: conversations.id });
    return { conversationId: conv!.id, contactId: c!.id };
  }
  const list = async (qs: string) => {
    const res = await asA("GET", `/inbox/conversations?${qs}`);
    expect(res.statusCode).toBe(200);
    return inboxConversationListResponseSchema.parse(res.json());
  };

  beforeAll(async () => {
    process.env["OUTBOUND_QUEUE_NAME"] = queueName;
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
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
      userA: await userId(accounts.a.email),
      userC: await userId(accounts.c.email),
    });
    await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: s.userC, role: "agent" });
    const [ch] = await migrator.db
      .insert(channelConnections)
      .values({ tenantId: s.tenantA, provider: "gupshup", phoneE164: "+34600000201", webhookToken: `t-${randomUUID()}`, status: "active" })
      .returning({ id: channelConnections.id });
    const [chB] = await migrator.db
      .insert(channelConnections)
      .values({ tenantId: s.tenantB, provider: "gupshup", phoneE164: "+34600000202", webhookToken: `t-${randomUUID()}`, status: "active" })
      .returning({ id: channelConnections.id });
    s.channelA = ch!.id;
    const now = Date.now();
    const c1 = await seedConv(s.tenantA, s.channelA, "+59171111111", "Ana 100%_off", new Date(now - 3000), ["vip"]);
    const c2 = await seedConv(s.tenantA, s.channelA, "+34622222222", "Bruno", new Date(now - 2000));
    const c3 = await seedConv(s.tenantA, s.channelA, "+5215500000000", "Carla", new Date(now - 1000), ["vip", "frio"]);
    const cb = await seedConv(s.tenantB, chB!.id, "+34633333333", "Otro", new Date(now));
    Object.assign(s, { conv1: c1.conversationId, conv2: c2.conversationId, conv3: c3.conversationId, contact1: c1.contactId, contact2: c2.contactId, convB: cb.conversationId });
    await migrator.db.insert(messages).values([
      { tenantId: s.tenantA, conversationId: s.conv2, direction: "inbound", type: "text", body: "precio del plan premium", status: "received", author: "contact" },
      { tenantId: s.tenantA, conversationId: s.conv1, direction: "inbound", type: "text", body: "hola", status: "received", author: "contact" },
    ]);
    await migrator.db.update(conversations).set({ lastReadAt: new Date(now + 60_000) }).where(eq(conversations.id, s.conv1));
    await migrator.db
      .insert(adAttributions)
      .values({ tenantId: s.tenantA, contactId: s.contact1, sourceId: "ad-1", sourceType: "ad", headline: "Promo", firstSeenAt: new Date(now - 5000) });
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

  it("settings: defaults, owner patch with audit, agents cannot patch", async () => {
    const get = await asA("GET", "/settings/inbox");
    expect(get.json()).toEqual({ autoAssign: "off", maxOpenPerAgent: null, visibility: "all", reopenOnInbound: true, pauseAutomationOnAgentReplyMinutes: 30 });
    expect((await asC("PATCH", "/settings/inbox", { visibility: "own" })).statusCode).toBe(403);
    const patch = await asA("PATCH", "/settings/inbox", { autoAssign: "round_robin", maxOpenPerAgent: 5 });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ autoAssign: "round_robin", maxOpenPerAgent: 5, visibility: "all" });
    expect((await asA("PATCH", "/settings/inbox", { visibility: "secret" })).statusCode).toBe(400);
    const audits = await migrator.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.tenantId, s.tenantA));
    expect(audits.map((x) => x.action)).toContain("inbox_settings.updated");
  });

  it("lists open conversations with filters, sort, search and cursor; never other tenants", async () => {
    const all = await list("status=open");
    expect(all.items.map((i) => i.id)).toEqual([s.conv3, s.conv2, s.conv1]);
    expect(all.items.map((i) => i.id)).not.toContain(s.convB);
    expect((await list("status=open&sort=oldest")).items.map((i) => i.id)).toEqual([s.conv1, s.conv2, s.conv3]);
    expect((await list("tag=vip")).items.map((i) => i.id)).toEqual([s.conv3, s.conv1]);
    expect((await list("unread=true")).items.map((i) => i.id)).toEqual([s.conv2]);
    expect((await list("q=premium")).items.map((i) => i.id)).toEqual([s.conv2]);
    // Wildcards are literal: "%_" only matches the name that contains them.
    expect((await list(`q=${encodeURIComponent("%_")}`)).items.map((i) => i.id)).toEqual([s.conv1]);
    expect((await list("q=%2B3462")).items.map((i) => i.id)).toEqual([s.conv2]);
    const p1 = await list("limit=2");
    expect(p1.items).toHaveLength(2);
    const p2 = await list(`limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`);
    expect(p2.items.map((i) => i.id)).toEqual([s.conv1]);
    expect(p2.nextCursor).toBeNull();
    const row = all.items.find((i) => i.id === s.conv3) as InboxConversation;
    expect(row).toMatchObject({ inboxStatus: "open", contactTags: ["vip", "frio"], markedUnread: false, nextReminderAt: null });
  });

  it("assigns to me, to a member, unassigns (audited) and rejects foreign users", async () => {
    const me = await asA("POST", `/inbox/conversations/${s.conv1}/assign`, { assignee: "me" });
    expect(me.statusCode).toBe(200);
    expect((me.json() as InboxConversation).assignee?.id).toBe(s.userA);
    expect((me.json() as InboxConversation).assignedAt).not.toBeNull();
    expect((await asA("POST", `/inbox/conversations/${s.conv2}/assign`, { assignee: s.userC })).statusCode).toBe(200);
    expect((await list("assignedTo=me")).items.map((i) => i.id)).toEqual([s.conv1]);
    expect((await list("assignedTo=unassigned")).items.map((i) => i.id)).toEqual([s.conv3]);
    const foreign = await asA("POST", `/inbox/conversations/${s.conv3}/assign`, { assignee: randomUUID() });
    expect(foreign.statusCode).toBe(400);
    expect((await asB("POST", `/inbox/conversations/${s.conv3}/assign`, { assignee: "me" })).statusCode).toBe(404);
    const un = await asA("POST", `/inbox/conversations/${s.conv1}/assign`, { assignee: null });
    expect((un.json() as InboxConversation).assignee).toBeNull();
    const audits = await migrator.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, s.conv1));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(["conversation.assigned", "conversation.unassigned"]));
  });

  it("closes and reopens, marks unread and read clears it", async () => {
    const closed = await asA("POST", `/inbox/conversations/${s.conv3}/status`, { status: "closed" });
    expect(closed.json()).toMatchObject({ inboxStatus: "closed" });
    expect((await list("status=closed")).items.map((i) => i.id)).toEqual([s.conv3]);
    expect((await list("status=all")).items).toHaveLength(3);
    await asA("POST", `/inbox/conversations/${s.conv3}/status`, { status: "open" });
    expect((await asA("POST", `/inbox/conversations/${s.conv1}/unread`)).statusCode).toBe(204);
    expect((await list("unread=true")).items.map((i) => i.id).sort()).toEqual([s.conv1, s.conv2].sort());
    expect((await asA("POST", `/conversations/${s.conv1}/read`)).statusCode).toBe(204);
    expect((await list("unread=true")).items.map((i) => i.id)).toEqual([s.conv2]);
    const audits = await migrator.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, s.conv3));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(["conversation.closed", "conversation.reopened"]));
  });

  it("internal notes: create/list, isolated per tenant, never a message", async () => {
    const created = await asA("POST", `/inbox/conversations/${s.conv2}/notes`, { body: "Cliente pidió descuento" });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ body: "Cliente pidió descuento", author: { id: s.userA } });
    const notes = await asA("GET", `/inbox/conversations/${s.conv2}/notes`);
    expect((notes.json() as { items: unknown[] }).items).toHaveLength(1);
    expect((await asB("GET", `/inbox/conversations/${s.conv2}/notes`)).statusCode).toBe(404);
    const msgs = await migrator.db.select({ body: messages.body }).from(messages).where(eq(messages.conversationId, s.conv2));
    expect(msgs.map((m) => m.body)).not.toContain("Cliente pidió descuento");
  });

  it("reminders: presets, custom validation, folder and counts", async () => {
    const r = await asA("POST", `/inbox/conversations/${s.conv3}/reminders`, { preset: "1h", note: "llamar" });
    expect(r.statusCode).toBe(201);
    const reminder = r.json() as { id: string; remindAt: string };
    expect(new Date(reminder.remindAt).getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
    expect((await asA("POST", `/inbox/conversations/${s.conv3}/reminders`, { preset: "custom" })).statusCode).toBe(400);
    expect(
      (await asA("POST", `/inbox/conversations/${s.conv3}/reminders`, { preset: "custom", remindAt: new Date(Date.now() - 1000).toISOString() })).statusCode,
    ).toBe(400);
    const folder = await list("reminders=true&status=all");
    expect(folder.items.map((i) => i.id)).toEqual([s.conv3]);
    expect(folder.items[0]!.nextReminderAt).toBe(reminder.remindAt);
    const counts = inboxCountsSchema.parse((await asA("GET", "/inbox/counts")).json()) as InboxCounts;
    expect(counts).toMatchObject({ open: 3, closed: 0, unread: 1, mine: 0, unassigned: 2, reminders: 1, remindersDue: 0 });
    expect(counts.tags).toEqual([
      { name: "frio", count: 1 },
      { name: "vip", count: 2 },
    ]);
    // Another user cannot complete my reminder.
    expect((await asC("PATCH", `/inbox/reminders/${reminder.id}`, { done: true })).statusCode).toBe(404);
    expect((await asA("PATCH", `/inbox/reminders/${reminder.id}`, { done: true })).json()).toMatchObject({ done: true });
    expect((await list("reminders=true&status=all")).items).toHaveLength(0);
  });

  it("visibility own: agents only see their own and unassigned conversations", async () => {
    await asA("PATCH", "/settings/inbox", { visibility: "own" });
    await asA("POST", `/inbox/conversations/${s.conv1}/assign`, { assignee: "me" });
    const res = await asC("GET", "/inbox/conversations?status=all");
    const ids = inboxConversationListResponseSchema.parse(res.json()).items.map((i) => i.id);
    expect(ids.sort()).toEqual([s.conv2, s.conv3].sort());
    expect((await asC("GET", `/inbox/conversations/${s.conv1}`)).statusCode).toBe(404);
    expect((await asC("GET", `/conversations/${s.conv1}/messages`)).statusCode).toBe(404);
    expect((await asC("GET", `/conversations/${s.conv1}`)).statusCode).toBe(404);
    // Owners still see everything.
    expect((await list("status=all")).items).toHaveLength(3);
    await asA("PATCH", "/settings/inbox", { visibility: "all" });
  });

  it("tags catalog: CRUD with emoji/color, rename rewrites contacts, delete removes the string", async () => {
    const created = await asA("POST", "/inbox/tags", { name: "vip", emoji: "⭐", color: "#FFAA00" });
    expect(created.statusCode).toBe(201);
    const tag = created.json() as { id: string; contactCount: number };
    expect(tag.contactCount).toBe(2);
    expect((await asA("POST", "/inbox/tags", { name: "vip" })).statusCode).toBe(409);
    expect((await asA("POST", "/inbox/tags", { name: "x", color: "red" })).statusCode).toBe(400);
    expect((await asB("GET", "/inbox/tags")).json()).toEqual({ items: [] });
    const renamed = await asA("PATCH", `/inbox/tags/${tag.id}`, { name: "premium" });
    expect(renamed.json()).toMatchObject({ name: "premium", emoji: "⭐", contactCount: 2 });
    const [ct] = await migrator.db.select({ tags: contacts.tags }).from(contacts).where(eq(contacts.id, s.contact1));
    expect(ct!.tags).toEqual(["premium"]);
    expect((await asC("DELETE", `/inbox/tags/${tag.id}`)).statusCode).toBe(403);
    expect((await asA("DELETE", `/inbox/tags/${tag.id}`)).statusCode).toBe(204);
    const [ct2] = await migrator.db.select({ tags: contacts.tags }).from(contacts).where(eq(contacts.id, s.contact1));
    expect(ct2!.tags).toEqual([]);
  });

  it("canned responses: CRUD, search and unique shortcut", async () => {
    const created = await asC("POST", "/inbox/canned-responses", { title: "Horario", body: "Abrimos 9 a 18", shortcut: "horario" });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    expect((await asA("POST", "/inbox/canned-responses", { title: "Otro", body: "x", shortcut: "horario" })).statusCode).toBe(409);
    expect((await asA("GET", "/inbox/canned-responses?q=hora")).json()).toMatchObject({ items: [{ id, shortcut: "horario" }] });
    expect((await asA("PATCH", `/inbox/canned-responses/${id}`, { body: "Abrimos 8 a 20" })).json()).toMatchObject({ body: "Abrimos 8 a 20" });
    expect((await asB("DELETE", `/inbox/canned-responses/${id}`)).statusCode).toBe(404);
    expect((await asA("DELETE", `/inbox/canned-responses/${id}`)).statusCode).toBe(204);
  });

  it("contact panel: origin, timezone and pause/resume automations", async () => {
    const p1 = await asA("GET", `/inbox/contacts/${s.contact1}/panel`);
    expect(p1.json()).toMatchObject({ origin: "ad", country: "BO", timezone: "America/La_Paz", ad: { sourceId: "ad-1", headline: "Promo" } });
    const p2 = await asA("GET", `/inbox/contacts/${s.contact2}/panel`);
    expect(p2.json()).toMatchObject({ origin: "whatsapp", country: "ES", timezone: "Europe/Madrid", ad: null });
    expect((await asB("GET", `/inbox/contacts/${s.contact1}/panel`)).statusCode).toBe(404);
    const [imported] = await migrator.db
      .insert(contacts)
      .values({ tenantId: s.tenantA, phoneE164: "+59170009999", name: "Importado", source: "import" })
      .returning({ id: contacts.id });
    expect((await asA("GET", `/inbox/contacts/${imported!.id}/panel`)).json()).toMatchObject({ origin: "import" });
    const paused = await asA("POST", `/inbox/contacts/${s.contact1}/pause-automations`, { minutes: 60 });
    expect(new Date((paused.json() as { automationsPausedUntil: string }).automationsPausedUntil).getTime()).toBeGreaterThan(Date.now());
    const resumed = await asA("POST", `/inbox/contacts/${s.contact1}/pause-automations`, { minutes: null });
    expect(resumed.json()).toEqual({ automationsPausedUntil: null });
  });

  it("a human reply pauses the contact's automations for the configured minutes", async () => {
    const res = await asA("POST", `/conversations/${s.conv2}/messages`, { text: "Hola!", clientMessageId: randomUUID() });
    expect(res.statusCode).toBe(202);
    const [ct] = await migrator.db.select({ until: contacts.automationsPausedUntil }).from(contacts).where(eq(contacts.id, s.contact2));
    const ms = (ct!.until?.getTime() ?? 0) - Date.now();
    expect(ms).toBeGreaterThan(29 * 60_000);
    expect(ms).toBeLessThanOrEqual(30 * 60_000);
  });
});
