import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { aiHandoffListSchema, aiRunListSchema } from "@crmwsp/contracts";
import {
  aiActions,
  channelConnections,
  contacts,
  conversations,
  createDb,
  eq,
  inArray,
  knowledgeChunks,
  knowledgeSources,
  memberships,
  messages,
  tenants,
  users,
  type DbHandle,
} from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

const hasEnv = Boolean(process.env["DATABASE_URL"] && process.env["DATABASE_URL_MIGRATOR"] && process.env["REDIS_URL"]);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
}

describe.skipIf(!hasEnv)("AI runs and handoff queue (e2e, real Postgres + Redis)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const mk = (k: string) => ({
    email: `runs-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password,
    tenantName: `Runs ${k}`,
    tenantSlug: `runs-${k}-${suffix}`,
  });
  const accounts = { a: mk("a"), b: mk("b"), agent: mk("agent"), viewer: mk("viewer") };
  const s = {} as { cookieA: string; cookieB: string; cookieAgent: string; cookieViewer: string; tenantA: string; tenantB: string };
  const ids = {} as { convOpen: string; convAnswered: string; convClosed: string; chunk: string; handoffOpen: string };

  const get = (url: string, who: "a" | "b" | "agent" | "viewer") => {
    const ctx = {
      a: { cookie: s.cookieA, tenant: s.tenantA },
      b: { cookie: s.cookieB, tenant: s.tenantB },
      agent: { cookie: s.cookieAgent, tenant: s.tenantA },
      viewer: { cookie: s.cookieViewer, tenant: s.tenantA },
    }[who];
    return app.inject({ method: "GET", url, headers: { cookie: ctx.cookie, "x-tenant-id": ctx.tenant } }) as unknown as Promise<InjectResult>;
  };

  async function signup(acc: ReturnType<typeof mk>): Promise<{ cookie: string; tenant: string }> {
    const res = (await app.inject({ method: "POST", url: "/auth/signup", payload: acc })) as unknown as InjectResult;
    expect(res.statusCode).toBe(201);
    const raw = res.headers["set-cookie"];
    return {
      cookie: ((Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "").split(";")[0] ?? "",
      tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id,
    };
  }

  beforeAll(async () => {
    process.env["ENCRYPTION_MASTER_KEY"] = randomBytes(32).toString("base64");
    process.env["ENCRYPTION_MASTER_KEY_ID"] = "1";
    process.env["AI_QUEUE_NAME"] = `ai-runs-test-${suffix}`;
    migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 2 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    const ag = await signup(accounts.agent);
    const vw = await signup(accounts.viewer);
    Object.assign(s, { cookieA: a.cookie, tenantA: a.tenant, cookieB: b.cookie, tenantB: b.tenant, cookieAgent: ag.cookie, cookieViewer: vw.cookie });
    for (const [email, role] of [
      [accounts.agent.email, "agent"],
      [accounts.viewer.email, "viewer"],
    ] as const) {
      const [u] = await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, email));
      await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: u!.id, role });
    }

    const [chan] = await migrator.db
      .insert(channelConnections)
      .values({ tenantId: s.tenantA, provider: "gupshup", phoneE164: "+34600000888", externalAppId: "App", webhookToken: randomBytes(32).toString("base64url"), status: "active" })
      .returning({ id: channelConnections.id });
    const mkConv = async (phone: string, name: string, inboxStatus: "open" | "closed" = "open") => {
      const [ct] = await migrator.db.insert(contacts).values({ tenantId: s.tenantA, phoneE164: phone, name }).returning({ id: contacts.id });
      const [cv] = await migrator.db
        .insert(conversations)
        .values({ tenantId: s.tenantA, contactId: ct!.id, channelConnectionId: chan!.id, status: "pending", inboxStatus })
        .returning({ id: conversations.id });
      return cv!.id;
    };
    ids.convOpen = await mkConv("+34622000001", "Ana Abierta");
    ids.convAnswered = await mkConv("+34622000002", "Beto Respondido");
    ids.convClosed = await mkConv("+34622000003", "Carla Cerrada", "closed");

    const [src] = await migrator.db
      .insert(knowledgeSources)
      .values({ tenantId: s.tenantA, kind: "text", title: "Lista de precios", status: "ready" })
      .returning({ id: knowledgeSources.id });
    const [chunk] = await migrator.db
      .insert(knowledgeChunks)
      .values({ tenantId: s.tenantA, sourceId: src!.id, sourceVersion: 1, ordinal: 0, content: "Cable HDMI 2m: 12,50 EUR" })
      .returning({ id: knowledgeChunks.id });
    ids.chunk = chunk!.id;

    const t0 = Date.now() - 3_600_000;
    const at = (min: number) => new Date(t0 + min * 60_000);
    const base = { tenantId: s.tenantA, decision: "auto" as const, status: "executed" as const, payload: {} };
    const inserted = await migrator.db
      .insert(aiActions)
      .values([
        { ...base, type: "send_reply", conversationId: ids.convOpen, payload: { text: "Cuesta 12,50 EUR" }, decisionReason: "all claims cited", model: "gpt-5-mini", createdAt: at(1), citations: [{ chunkId: ids.chunk, sourceId: src!.id, sourceVersion: 1 }] },
        { ...base, type: "draft_reply", status: "proposed", conversationId: ids.convOpen, payload: { text: "Borrador" }, decisionReason: "assist mode", createdAt: at(2) },
        { ...base, type: "handoff", conversationId: ids.convOpen, payload: { type: "handoff", reason: "budget_exceeded" }, decisionReason: "budget_exceeded", createdAt: at(3) },
        { ...base, type: "handoff", conversationId: ids.convAnswered, decisionReason: "invalid_output", createdAt: at(4) },
        { ...base, type: "handoff", conversationId: ids.convClosed, decisionReason: "customer asked for a human", createdAt: at(5) },
        { ...base, type: "update_contact_field", conversationId: ids.convOpen, createdAt: at(6) },
      ])
      .returning({ id: aiActions.id, type: aiActions.type, conversationId: aiActions.conversationId, reason: aiActions.decisionReason });
    ids.handoffOpen = inserted.find((r) => r.type === "handoff" && r.conversationId === ids.convOpen)!.id;
    // A human answered after the handoff: no longer waiting.
    await migrator.db.insert(messages).values({ tenantId: s.tenantA, conversationId: ids.convAnswered, direction: "outbound", type: "text", body: "Hola", status: "sent", author: "user", createdAt: at(10) });
    // Tenant B noise that must never leak.
    await migrator.db.insert(aiActions).values({ tenantId: s.tenantB, type: "send_reply", decision: "auto", status: "executed", payload: { text: "secret" } });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((a) => a.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((a) => a.email)));
      await migrator.close();
    }
  });

  it("lists runs newest first with outcome, mode and enriched citations; skips non-run actions", async () => {
    const res = await get("/ai/runs", "a");
    expect(res.statusCode).toBe(200);
    const { items, nextCursor } = aiRunListSchema.parse(res.json());
    expect(nextCursor).toBeNull();
    expect(items.map((i) => i.outcome)).toEqual(["handoff", "error", "blocked", "draft", "sent"]);
    const sent = items.find((i) => i.outcome === "sent")!;
    expect(sent).toMatchObject({ mode: "auto", contactName: "Ana Abierta", model: "gpt-5-mini", text: "Cuesta 12,50 EUR", conversationId: ids.convOpen });
    expect(sent.citations).toHaveLength(1);
    expect(sent.citations[0]).toMatchObject({ chunkId: ids.chunk, title: "Lista de precios", excerpt: "Cable HDMI 2m: 12,50 EUR" });
    expect(items.find((i) => i.outcome === "draft")!.mode).toBe("draft");
    expect(items.find((i) => i.outcome === "blocked")!.mode).toBeNull();
  });

  it("filters by outcome and mode, and paginates with a cursor", async () => {
    const blocked = aiRunListSchema.parse((await get("/ai/runs?outcome=blocked", "a")).json());
    expect(blocked.items.map((i) => i.reason)).toEqual(["budget_exceeded"]);
    expect(aiRunListSchema.parse((await get("/ai/runs?outcome=error", "a")).json()).items.map((i) => i.reason)).toEqual(["invalid_output"]);
    expect(aiRunListSchema.parse((await get("/ai/runs?outcome=handoff", "a")).json()).items.map((i) => i.reason)).toEqual(["customer asked for a human"]);
    expect(aiRunListSchema.parse((await get("/ai/runs?mode=auto", "a")).json()).items.map((i) => i.outcome)).toEqual(["sent"]);

    const page1 = aiRunListSchema.parse((await get("/ai/runs?limit=2", "a")).json());
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = aiRunListSchema.parse((await get(`/ai/runs?limit=2&cursor=${page1.nextCursor}`, "a")).json());
    const page3 = aiRunListSchema.parse((await get(`/ai/runs?limit=2&cursor=${page2.nextCursor}`, "a")).json());
    expect([...page1.items, ...page2.items, ...page3.items]).toHaveLength(5);
    expect(page3.nextCursor).toBeNull();
    expect((await get("/ai/runs?limit=0", "a")).statusCode).toBe(400);
    expect((await get("/ai/runs?cursor=not-a-cursor", "a")).statusCode).toBe(400);
  });

  it("isolates tenants and rejects viewers", async () => {
    const b = aiRunListSchema.parse((await get("/ai/runs", "b")).json());
    expect(b.items).toHaveLength(1);
    expect(b.items[0]!.text).toBe("secret");
    expect(aiHandoffListSchema.parse((await get("/ai/handoffs", "b")).json()).items).toHaveLength(0);
    expect((await get("/ai/runs", "viewer")).statusCode).toBe(403);
    expect((await get("/ai/handoffs", "viewer")).statusCode).toBe(403);
    expect((await get("/ai/runs", "agent")).statusCode).toBe(200);
  });

  it("queues only open, unanswered handoffs using the latest handoff of each conversation", async () => {
    const res = await get("/ai/handoffs", "a");
    expect(res.statusCode).toBe(200);
    const { items } = aiHandoffListSchema.parse(res.json());
    // convAnswered has a later human reply; convClosed is closed in the inbox.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: ids.handoffOpen, conversationId: ids.convOpen, contactName: "Ana Abierta", reason: "budget_exceeded", assigneeId: null });
    expect(aiHandoffListSchema.parse((await get("/ai/handoffs?assignedTo=me", "a")).json()).items).toHaveLength(0);
    expect(aiHandoffListSchema.parse((await get("/ai/handoffs?assignedTo=unassigned", "a")).json()).items).toHaveLength(1);
  });
});
