import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { inboxCountsSchema, unansweredQuoteListResponseSchema, unansweredQuoteReviewSchema, type UnansweredQuoteListResponse } from "@crmwsp/contracts";
import {
  auditEvents,
  channelConnections,
  contacts,
  conversationNotes,
  conversations,
  createDb,
  eq,
  followUps,
  inArray,
  memberships,
  messages,
  quoteSends,
  quoteUnansweredReviews,
  quotes,
  tenantPlans,
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

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DELAY_MS = 48 * HOUR;
const COVERAGE_MS = 168 * HOUR;

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
  body: string;
}
type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Sender = (method: Method, url: string, payload?: unknown) => Promise<InjectResult>;

interface Reply {
  agoMs: number;
  direction: "inbound" | "outbound";
  author: "contact" | "ai" | "user";
}

interface CaseInput {
  name: string;
  phone: string;
  status?: "open" | "pending" | "resolved";
  assignee?: string | null;
  quoteStatus?: "sent" | "accepted";
  currency?: string;
  totalMinor?: bigint;
  validForMs?: number;
  messageStatus?: "queued" | "sent" | "failed" | "delivered";
  /** Age of the confirmed send; null leaves the message without `sent_at`. */
  sentAgoMs?: number | null;
  /** Delay between message creation and confirmed provider send. */
  sentDelayMs?: number;
  link?: boolean;
  replies?: Reply[];
  inChat?: { contactId: string; conversationId: string };
}

interface SeededCase {
  number: string;
  quoteId: string;
  conversationId: string;
  contactId: string;
  messageId: string;
}

const cookieOf = (res: InjectResult): string => {
  const raw = res.headers["set-cookie"];
  return ((Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "").split(";")[0] ?? "";
};

describe.skipIf(!hasEnv)("unanswered quotes (e2e, real Postgres + Redis)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  let outboundQueue: Queue;
  let nowMs: number;
  const suffix = randomUUID().slice(0, 8);
  const queueName = `outbound-unanswered-${suffix}`;
  const mk = (k: string) => ({
    email: `unanswered-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password: "correct-horse-battery",
    tenantName: `Tenant ${k}`,
    tenantSlug: `unanswered-${k}-${suffix}`,
  });
  const accounts = { a: mk("a"), b: mk("b"), c: mk("c"), d: mk("d"), e: mk("e") };
  const s = {} as {
    cookieA: string;
    cookieB: string;
    cookieC: string;
    cookieD: string;
    cookieE: string;
    tenantA: string;
    userA: string;
    userC: string;
    userD: string;
    userE: string;
    channelA: string;
    channelB: string;
    channelA2: string;
  };
  const seeded = {} as Record<string, SeededCase>;

  const sender =
    (cookie: string, tenant: string): Sender =>
    (method, url, payload) =>
      app.inject({
        method,
        url,
        ...(payload !== undefined ? { payload: payload as object } : {}),
        headers: { cookie, "x-tenant-id": tenant },
      }) as unknown as Promise<InjectResult>;
  let asA: Sender;
  let asB: Sender;
  let asC: Sender;
  let asD: Sender;
  let asE: Sender;

  const list = async (as: Sender, qs = ""): Promise<UnansweredQuoteListResponse> => {
    const res = await as("GET", `/quotes/unanswered?${qs}`);
    if (res.statusCode !== 200) throw new Error(`GET /quotes/unanswered -> ${res.statusCode} ${res.body}`);
    return unansweredQuoteListResponseSchema.parse(res.json());
  };
  const ids = (res: UnansweredQuoteListResponse): string[] => res.items.map((i) => i.quoteId);
  const review = async (as: Sender, quoteId: string): Promise<InjectResult> => as("POST", `/quotes/unanswered/${quoteId}/review`);

  async function signup(acc: ReturnType<typeof mk>): Promise<{ cookie: string; tenant: string }> {
    const res = (await app.inject({ method: "POST", url: "/auth/signup", payload: acc })) as unknown as InjectResult;
    expect(res.statusCode).toBe(201);
    return { cookie: cookieOf(res), tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id };
  }
  const userId = async (email: string) => (await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!.id;

  async function seedCase(key: string, input: CaseInput): Promise<SeededCase> {
    const db = migrator.db;
    const now = nowMs;
    const sentAt = input.sentAgoMs === null ? null : new Date(now - (input.sentAgoMs ?? 0));
    const queuedAt = new Date(now - (input.sentAgoMs ?? 0) - (input.sentDelayMs ?? HOUR));
    let contactId = input.inChat?.contactId;
    let conversationId = input.inChat?.conversationId;
    if (!contactId) {
      const [ct] = await db.insert(contacts).values({ tenantId: s.tenantA, phoneE164: input.phone, name: input.name }).returning({ id: contacts.id });
      contactId = ct!.id;
    }
    if (!conversationId) {
      const [conv] = await db
        .insert(conversations)
        .values({
          tenantId: s.tenantA,
          contactId,
          channelConnectionId: s.channelA,
          status: input.status ?? "open",
          assignedUserId: input.assignee ?? null,
          lastMessageAt: queuedAt,
        })
        .returning({ id: conversations.id });
      conversationId = conv!.id;
    }
    const number = `COT-${key.toUpperCase()}-${suffix}`;
    const [q] = await db
      .insert(quotes)
      .values({
        tenantId: s.tenantA,
        number,
        contactId,
        conversationId,
        status: input.quoteStatus ?? "sent",
        currency: input.currency ?? "EUR",
        totalMinor: input.totalMinor ?? 15000n,
        validUntil: new Date(now + (input.validForMs ?? 30 * 24 * HOUR)),
        sentAt: queuedAt,
        createdByType: "user",
      })
      .returning({ id: quotes.id });
    const [m] = await db
      .insert(messages)
      .values({
        tenantId: s.tenantA,
        conversationId,
        direction: "outbound",
        type: "text",
        body: `Presupuesto ${number}`,
        status: input.messageStatus ?? "sent",
        author: "user",
        authorUserId: s.userA,
        sentAt,
        createdAt: queuedAt,
      })
      .returning({ id: messages.id });
    if (!q || !m) throw new Error("seed failed");
    if (input.link !== false) await db.insert(quoteSends).values({ tenantId: s.tenantA, quoteId: q.id, messageId: m.id });
    for (const reply of input.replies ?? []) {
      const at = new Date(now - reply.agoMs);
      await db.insert(messages).values({
        tenantId: s.tenantA,
        conversationId,
        direction: reply.direction,
        type: "text",
        body: "hola",
        status: reply.direction === "inbound" ? "received" : "sent",
        author: reply.author,
        sentAt: at,
        createdAt: at,
      });
    }
    const seededCase = { number, quoteId: q.id, conversationId, contactId, messageId: m.id };
    seeded[key] = seededCase;
    return seededCase;
  }

  async function setAutomation(enabled: boolean): Promise<void> {
    const db = migrator.db;
    const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, s.tenantA));
    await db
      .update(tenants)
      .set({ settings: { ...(t?.settings ?? {}), followUps: { quoteUnanswered: { enabled, delayHours: 48, message: "Hi!", templateId: null } } } })
      .where(eq(tenants.id, s.tenantA));
  }
  const badge = async (as: Sender): Promise<number | undefined> => {
    const res = await as("GET", "/inbox/counts");
    expect(res.statusCode).toBe(200);
    return inboxCountsSchema.parse(res.json()).unanswered;
  };

  beforeAll(async () => {
    process.env["OUTBOUND_QUEUE_NAME"] = queueName;
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    outboundQueue = new Queue(queueName, { connection: new Redis(REDIS_URL as string, { maxRetriesPerRequest: null }) });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    nowMs = Date.now();
    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    const c = await signup(accounts.c);
    const d = await signup(accounts.d);
    const e = await signup(accounts.e);
    const own = { userC: await userId(accounts.c.email), userD: await userId(accounts.d.email), userE: await userId(accounts.e.email) };
    Object.assign(s, {
      cookieA: a.cookie,
      tenantA: a.tenant,
      userA: await userId(accounts.a.email),
      cookieB: b.cookie,
      cookieC: c.cookie,
      cookieD: d.cookie,
      cookieE: e.cookie,
      ...own,
    });
    asA = sender(a.cookie, s.tenantA);
    asB = sender(b.cookie, b.tenant);
    asC = sender(c.cookie, s.tenantA);
    asD = sender(d.cookie, s.tenantA);
    asE = sender(e.cookie, s.tenantA);
    await migrator.db.update(tenantPlans).set({ setupEndsAt: null }).where(inArray(tenantPlans.tenantId, [a.tenant, b.tenant, c.tenant, d.tenant, e.tenant]));
    await migrator.db.insert(memberships).values([
      { tenantId: s.tenantA, userId: s.userC, role: "agent" },
      { tenantId: s.tenantA, userId: s.userD, role: "viewer" },
      { tenantId: s.tenantA, userId: s.userE, role: "agent" },
    ]);
    const channel = (tenantId: string, phone: string) =>
      migrator.db
        .insert(channelConnections)
        .values({ tenantId, provider: "gupshup", phoneE164: phone, webhookToken: `t-${randomUUID()}`, status: "active" })
        .returning({ id: channelConnections.id });
    const [chA] = await channel(s.tenantA, "+34600000301");
    const [chA2] = await channel(s.tenantA, "+34600000302");
    const [chB] = await channel(b.tenant, "+34600000303");
    if (!chA || !chA2 || !chB) throw new Error("seed failed");
    Object.assign(s, { channelA: chA.id, channelA2: chA2.id, channelB: chB.id });
    await setAutomation(false);
  });

  afterAll(async () => {
    if (app) await app.close();
    await outboundQueue?.obliterate({ force: true }).catch(() => undefined);
    await outboundQueue?.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((x) => x.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((x) => x.email)));
      await migrator.close();
    }
  });

  const DUE = DELAY_MS + 2 * MINUTE;

  it("lists confirmed sends once the delay has elapsed, oldest case first", async () => {
    await seedCase("oldest", { name: "Viejo", phone: "+59170000001", sentAgoMs: DELAY_MS + COVERAGE_MS - 30 * MINUTE });
    await seedCase("due", { name: "Ana", phone: "+59170000002", sentAgoMs: DUE, currency: "BOB", totalMinor: 125000n });
    await seedCase("early", { name: "Bruno", phone: "+59170000003", sentAgoMs: DELAY_MS - 2 * MINUTE });
    await seedCase("queued", { name: "Carla", phone: "+59170000004", sentAgoMs: null, messageStatus: "queued" });
    await seedCase("failed", { name: "Diego", phone: "+59170000005", sentAgoMs: null, messageStatus: "failed" });
    await seedCase("legacy", { name: "Elena", phone: "+59170000006", sentAgoMs: 50 * HOUR, link: false });
    const noted = await seedCase("noted", { name: "Félix", phone: "+59170000007", sentAgoMs: DUE });
    await migrator.db.insert(conversationNotes).values({ tenantId: s.tenantA, conversationId: noted.conversationId, authorId: s.userA, body: "nota interna" });
    await seedCase("repliedBeforeSend", {
      name: "Antes del envío confirmado",
      phone: "+59170000021",
      sentAgoMs: DUE,
      sentDelayMs: 5 * MINUTE,
      replies: [{ agoMs: DUE + 2 * MINUTE, direction: "inbound", author: "contact" }],
    });
    await seedCase("aiReplied", { name: "Gala", phone: "+59170000008", sentAgoMs: DUE, replies: [{ agoMs: DELAY_MS, direction: "outbound", author: "ai" }] });
    const other = await seedCase("otherChat", { name: "Hugo", phone: "+59170000009", sentAgoMs: DUE });
    const [otherConv] = await migrator.db
      .insert(conversations)
      .values({ tenantId: s.tenantA, contactId: other.contactId, channelConnectionId: s.channelA2 })
      .returning({ id: conversations.id });
    await migrator.db.insert(messages).values({ tenantId: s.tenantA, conversationId: otherConv!.id, direction: "inbound", type: "text", status: "received", author: "contact", sentAt: new Date() });
    await seedCase("answered", { name: "Irene", phone: "+59170000010", sentAgoMs: DUE, replies: [{ agoMs: DELAY_MS, direction: "inbound", author: "contact" }] });
    await seedCase("expired", { name: "Julián", phone: "+59170000011", sentAgoMs: DUE, validForMs: -HOUR });
    await seedCase("accepted", { name: "Karin", phone: "+59170000012", sentAgoMs: DUE, quoteStatus: "accepted" });
    await seedCase("resolvedChat", { name: "Luis", phone: "+59170000013", sentAgoMs: DUE, status: "resolved" });
    await seedCase("beyondCoverage", { name: "Mara", phone: "+59170000014", sentAgoMs: DELAY_MS + COVERAGE_MS + 5 * MINUTE });
    const reminder = await seedCase("withReminder", { name: "Nico", phone: "+59170000015", sentAgoMs: DUE });
    await migrator.db.insert(followUps).values({
      tenantId: s.tenantA,
      conversationId: reminder.conversationId,
      quoteId: reminder.quoteId,
      rule: "quote_unanswered",
      dedupeKey: `quote_unanswered:${reminder.quoteId}`,
      reason: "quote_unanswered",
      messageBody: "Hi!",
      scheduledAt: new Date(Date.now() + 3 * HOUR),
      status: "scheduled",
    });
    const tie1 = await seedCase("tie1", { name: "Omar", phone: "+59170000016", sentAgoMs: DELAY_MS + MINUTE });
    const chat = { contactId: tie1.contactId, conversationId: tie1.conversationId };
    await seedCase("tie2", { name: "Omar", phone: "+59170000016", sentAgoMs: DELAY_MS + MINUTE, inChat: chat });
    await seedCase("tie3", { name: "Omar", phone: "+59170000016", sentAgoMs: DELAY_MS + MINUTE, inChat: chat });

    const res = await list(asA);
    const byQuoteId = (a: string, b: string) => (seeded[a]!.quoteId < seeded[b]!.quoteId ? -1 : 1);
    const expected = [
      "oldest",
      ...["due", "noted", "aiReplied", "otherChat", "withReminder", "repliedBeforeSend"].sort(byQuoteId),
      ...["tie1", "tie2", "tie3"].sort(byQuoteId),
    ].map((k) => seeded[k]!.quoteId);
    expect(ids(res)).toEqual(expected);
    expect(res.counts).toEqual({ eligible: 10, unknownCoverage: 1 });

    const due = res.items.find((i) => i.quoteId === seeded.due!.quoteId)!;
    expect(due).toMatchObject({
      number: seeded.due!.number,
      conversationId: seeded.due!.conversationId,
      contactName: "Ana",
      totalMinor: 125000,
      currency: "BOB",
      assignee: null,
      reminderAt: null,
    });
    expect(new Date(due.eligibleAt).getTime()).toBe(new Date(due.sentAt).getTime() + DELAY_MS);
    expect(res.items.find((i) => i.quoteId === seeded.withReminder!.quoteId)!.reminderAt).not.toBeNull();
    expect(new Set(res.items.filter((i) => i.conversationId === chat.conversationId).map((i) => i.number)).size).toBe(3);
    const opened = await asA("GET", `/inbox/conversations/${seeded.due!.conversationId}`);
    expect(opened.statusCode).toBe(200);
    expect((await asA("GET", "/quotes/unanswered?limit=101")).statusCode).toBe(400);
    expect((await asA("GET", "/quotes/unanswered?cursor=garbage")).statusCode).toBe(400);
  });

  it("pages stably with a keyset cursor, including ties", async () => {
    const all = ids(await list(asA));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await list(asA, `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      seen.push(...ids(res));
      if (res.nextCursor === null) break;
      const nextQs = `limit=2&cursor=${encodeURIComponent(res.nextCursor)}`;
      expect(ids(await list(asA, nextQs))).toEqual(ids(await list(asA, nextQs)));
      cursor = res.nextCursor;
    }
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("lists, opens and refreshes without queuing any send, with automation off and on", async () => {
    expect(await outboundQueue.count()).toBe(0);
    expect((await list(asA)).items).toHaveLength(10);
    await setAutomation(true);
    expect((await list(asA)).counts.eligible).toBe(10);
    expect(await badge(asA)).toBe(10);
    await setAutomation(false);
    expect((await list(asA)).counts.eligible).toBe(10);
    expect(await badge(asA)).toBe(10);
    expect(await outboundQueue.count()).toBe(0);
  });

  it("isolates tenants, honours own mode and reassignment, and keeps viewers read-only", async () => {
    const due = seeded.due!;
    expect(await list(asB)).toEqual({ items: [], nextCursor: null, counts: { eligible: 0, unknownCoverage: 0 } });
    expect(await badge(asB)).toBe(0);
    expect((await review(asB, due.quoteId)).statusCode).toBe(404);
    expect(ids(await list(asD))).toHaveLength(10);
    expect((await review(asD, due.quoteId)).statusCode).toBe(403);

    expect((await asA("PATCH", "/settings/inbox", { visibility: "own" })).statusCode).toBe(200);
    expect(ids(await list(asC))).toHaveLength(10);
    const mine = await seedCase("mine", { name: "Pat", phone: "+59170000017", sentAgoMs: DUE, assignee: s.userC });
    const theirs = await seedCase("theirs", { name: "Rosa", phone: "+59170000018", sentAgoMs: DUE, assignee: s.userE });

    const forC = ids(await list(asC));
    expect(forC).toContain(mine.quoteId);
    expect(forC).not.toContain(theirs.quoteId);
    const forE = ids(await list(asE));
    expect(forE).toContain(theirs.quoteId);
    expect(forE).not.toContain(mine.quoteId);
    expect(await badge(asC)).toBe(11);
    expect(await badge(asA)).toBe(12);
    expect((await review(asC, theirs.quoteId)).statusCode).toBe(404);

    expect((await asA("POST", `/inbox/conversations/${theirs.conversationId}/assign`, { assignee: s.userC })).statusCode).toBe(200);
    expect(ids(await list(asC))).toContain(theirs.quoteId);
    expect(await badge(asC)).toBe(12);
    expect((await review(asC, mine.quoteId)).statusCode).toBe(200);
    expect(ids(await list(asC))).not.toContain(mine.quoteId);
    expect((await review(asE, mine.quoteId)).statusCode).toBe(404);

    expect((await asA("PATCH", "/settings/inbox", { visibility: "all" })).statusCode).toBe(200);
    const first = unansweredQuoteReviewSchema.parse((await review(asC, mine.quoteId)).json());
    expect(first.reviewedBy).toBe(s.userC);
    expect(unansweredQuoteReviewSchema.parse((await review(asE, mine.quoteId)).json())).toEqual(first);
    expect(first.messageId).toBe(mine.messageId);
  });

  it("keeps one review when two agents review at once and leaves the quote and its reminder alone", async () => {
    const target = seeded.withReminder!;
    const [r1, r2] = await Promise.all([review(asA, target.quoteId), review(asC, target.quoteId)]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual(r1.json());
    const body = unansweredQuoteReviewSchema.parse(r1.json());
    expect(body.messageId).toBe(target.messageId);
    const reviews = await migrator.db.select().from(quoteUnansweredReviews).where(eq(quoteUnansweredReviews.quoteId, target.quoteId));
    expect(reviews).toHaveLength(1);
    const [quote] = await migrator.db.select({ status: quotes.status }).from(quotes).where(eq(quotes.id, target.quoteId));
    expect(quote?.status).toBe("sent");
    const [followUp] = await migrator.db.select({ status: followUps.status }).from(followUps).where(eq(followUps.quoteId, target.quoteId));
    expect(followUp?.status).toBe("scheduled");
    const audits = await migrator.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, target.quoteId));
    expect(audits.map((a) => a.action).filter((a) => a === "quote.unanswered_reviewed")).toHaveLength(1);
    for (const as of [asA, asC, asE, asD]) expect(ids(await list(as))).not.toContain(target.quoteId);
    expect(await badge(asA)).toBe(10);
    expect(unansweredQuoteReviewSchema.parse((await review(asA, target.quoteId)).json())).toEqual(body);
    expect((await review(asA, randomUUID())).statusCode).toBe(404);
    expect((await review(asA, "not-a-uuid")).statusCode).toBe(404);
    expect(await outboundQueue.count()).toBe(0);
  });

  it("refuses the review when the customer answers while the row is open", async () => {
    const late = await seedCase("late", { name: "Sara", phone: "+59170000019", sentAgoMs: DUE });
    expect(ids(await list(asA))).toContain(late.quoteId);
    await migrator.db.insert(messages).values({
      tenantId: s.tenantA,
      conversationId: late.conversationId,
      direction: "inbound",
      type: "text",
      status: "received",
      author: "contact",
      sentAt: new Date(),
    });
    expect((await review(asA, late.quoteId)).statusCode).toBe(409);
    expect(ids(await list(asA))).not.toContain(late.quoteId);
  });

  it("links new sends to their message and lists them once the provider confirms", async () => {
    const db = migrator.db;
    const [ct] = await db.insert(contacts).values({ tenantId: s.tenantA, phoneE164: "+59170000020", name: "Tom" }).returning({ id: contacts.id });
    const [conv] = await db
      .insert(conversations)
      .values({ tenantId: s.tenantA, contactId: ct!.id, channelConnectionId: s.channelA, lastInboundAt: new Date() })
      .returning({ id: conversations.id });
    const [q] = await db
      .insert(quotes)
      .values({ tenantId: s.tenantA, number: `COT-NEW-${suffix}`, contactId: ct!.id, conversationId: conv!.id, status: "approved", currency: "EUR", totalMinor: 9900n, validUntil: new Date(Date.now() + 24 * HOUR), createdByType: "user" })
      .returning({ id: quotes.id });
    const sent = await asA("POST", `/quotes/${q!.id}/send`);
    expect(sent.statusCode).toBe(202);
    const [event] = await db.select({ diff: auditEvents.diff }).from(auditEvents).where(eq(auditEvents.entityId, q!.id));
    const links = await db.select({ messageId: quoteSends.messageId }).from(quoteSends).where(eq(quoteSends.quoteId, q!.id));
    expect(links).toEqual([{ messageId: event!.diff["messageId"] }]);
    expect((await list(asA)).counts).toEqual({ eligible: 10, unknownCoverage: 1 });

    await db.update(messages).set({ status: "sent", sentAt: new Date(Date.now() - 49 * HOUR) }).where(eq(messages.id, links[0]!.messageId));
    const res = await list(asA);
    expect(res.items.map((i) => i.quoteId)).toContain(q!.id);
    expect(res.items.find((i) => i.quoteId === q!.id)!.conversationId).toBe(conv!.id);
  });
});
