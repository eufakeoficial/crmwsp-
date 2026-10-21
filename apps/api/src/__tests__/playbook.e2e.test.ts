import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { aiRunListSchema, aiRunsSummarySchema, playbookResponseSchema } from "@crmwsp/contracts";
import { DEFAULT_PLAYBOOK } from "@crmwsp/domain";
import {
  aiActions,
  channelConnections,
  contacts,
  conversations,
  createDb,
  eq,
  inArray,
  memberships,
  orders,
  payments,
  quotes,
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

describe.skipIf(!hasEnv)("sales playbook config and outcome attribution (e2e, real Postgres + Redis)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const mk = (k: string) => ({
    email: `pb-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password,
    tenantName: `Playbook ${k}`,
    tenantSlug: `pb-${k}-${suffix}`,
  });
  const accounts = { a: mk("a"), b: mk("b"), agent: mk("agent") };
  const s = {} as { cookieA: string; cookieB: string; cookieAgent: string; tenantA: string; tenantB: string };

  const call = (method: "GET" | "PUT", url: string, who: "a" | "b" | "agent", payload?: unknown) => {
    const ctx = {
      a: { cookie: s.cookieA, tenant: s.tenantA },
      b: { cookie: s.cookieB, tenant: s.tenantB },
      agent: { cookie: s.cookieAgent, tenant: s.tenantA },
    }[who];
    return app.inject({
      method,
      url,
      headers: { cookie: ctx.cookie, "x-tenant-id": ctx.tenant },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    }) as unknown as Promise<InjectResult>;
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
    process.env["AI_QUEUE_NAME"] = `playbook-test-${suffix}`;
    migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 2 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    const ag = await signup(accounts.agent);
    Object.assign(s, { cookieA: a.cookie, tenantA: a.tenant, cookieB: b.cookie, tenantB: b.tenant, cookieAgent: ag.cookie });
    const [u] = await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, accounts.agent.email));
    await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: u!.id, role: "agent" });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((x) => x.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((x) => x.email)));
      await migrator.close();
    }
  });

  it("returns the disabled Spanish defaults until something is saved", async () => {
    const res = await call("GET", "/ai/playbook", "a");
    expect(res.statusCode).toBe(200);
    const body = playbookResponseSchema.parse(res.json());
    expect(body).toMatchObject({ saved: false, enabled: false, closingStyle: "soft", updatedAt: null });
    expect(body.objections.map((o) => o.id)).toEqual(DEFAULT_PLAYBOOK.objections.map((o) => o.id));
  });

  it("saves, round-trips and isolates by tenant; agents are rejected", async () => {
    const cfg = {
      enabled: true,
      stages: { ...DEFAULT_PLAYBOOK.stages, closing: "Propón el pago." },
      objections: [{ id: "es-caro", trigger: "Dice que es caro", response: "Explica el valor." }],
      closingStyle: "direct",
      followUp: { enabled: true, delayHours: 6, maxFollowUps: 3 },
    };
    const put = await call("PUT", "/ai/playbook", "a", cfg);
    expect(put.statusCode).toBe(200);
    expect(playbookResponseSchema.parse(put.json())).toMatchObject({ saved: true, enabled: true, closingStyle: "direct", followUp: cfg.followUp });
    const got = playbookResponseSchema.parse((await call("GET", "/ai/playbook", "a")).json());
    expect(got.stages.closing).toBe("Propón el pago.");
    expect(got.objections).toHaveLength(1);
    // Tenant B still sees the defaults.
    expect(playbookResponseSchema.parse((await call("GET", "/ai/playbook", "b")).json())).toMatchObject({ saved: false, enabled: false });
    expect((await call("GET", "/ai/playbook", "agent")).statusCode).toBe(403);
    expect((await call("PUT", "/ai/playbook", "agent", cfg)).statusCode).toBe(403);
  });

  it("rejects follow-ups outside the 24h window and duplicated objection ids", async () => {
    const base = { ...DEFAULT_PLAYBOOK, enabled: true };
    expect((await call("PUT", "/ai/playbook", "a", { ...base, followUp: { enabled: true, delayHours: 24, maxFollowUps: 1 } })).statusCode).toBe(400);
    const o = DEFAULT_PLAYBOOK.objections[0]!;
    expect((await call("PUT", "/ai/playbook", "a", { ...base, objections: [o, o] })).statusCode).toBe(400);
  });

  it("shows stage/objection per run and counts only later accepted quotes and verified payments", async () => {
    const [chan] = await migrator.db
      .insert(channelConnections)
      .values({ tenantId: s.tenantA, provider: "gupshup", phoneE164: "+34600000777", externalAppId: "App", webhookToken: randomBytes(32).toString("base64url"), status: "active" })
      .returning({ id: channelConnections.id });
    const mkConv = async (phone: string) => {
      const [ct] = await migrator.db.insert(contacts).values({ tenantId: s.tenantA, phoneE164: phone, name: phone }).returning({ id: contacts.id });
      const [cv] = await migrator.db
        .insert(conversations)
        .values({ tenantId: s.tenantA, contactId: ct!.id, channelConnectionId: chan!.id, status: "pending" })
        .returning({ id: conversations.id });
      return { contactId: ct!.id, conversationId: cv!.id };
    };
    const [c1, c2, c3, c4] = [await mkConv("+34633000001"), await mkConv("+34633000002"), await mkConv("+34633000003"), await mkConv("+34633000004")];
    const now = Date.now();
    const at = (min: number) => new Date(now + min * 60_000);
    const run = (conv: { conversationId: string }, payload: Record<string, unknown>, min: number) => ({
      tenantId: s.tenantA,
      conversationId: conv.conversationId,
      type: "send_reply",
      decision: "auto" as const,
      status: "executed" as const,
      payload: { text: "hola", ...payload },
      createdAt: at(min),
    });
    await migrator.db.insert(aiActions).values([
      run(c1!, { salesStage: "objections", objection: "es-caro" }, -60),
      run(c2!, { salesStage: "closing" }, -60),
      run(c3!, { salesStage: "closing" }, -60),
      run(c4!, { salesStage: "discovery" }, -60),
      { ...run(c4!, {}, -59), payload: { text: "sin etapa" } },
    ]);
    const quote = (conv: { contactId: string; conversationId: string }, number: string, acceptedAt: Date) => ({
      tenantId: s.tenantA,
      number,
      contactId: conv.contactId,
      conversationId: conv.conversationId,
      status: "accepted" as const,
      currency: "EUR",
      validUntil: at(60 * 24),
      acceptedAt,
      createdByType: "ai" as const,
    });
    await migrator.db.insert(quotes).values([quote(c1!, `Q-${suffix}-1`, at(-10)), quote(c4!, `Q-${suffix}-4`, at(-120))]);
    const order = async (conv: { contactId: string; conversationId: string }, number: string, payStatus: "succeeded" | "pending") => {
      const [o] = await migrator.db
        .insert(orders)
        .values({
          tenantId: s.tenantA,
          number,
          contactId: conv.contactId,
          conversationId: conv.conversationId,
          currency: "EUR",
          fulfillment: "service",
          createdByType: "ai",
          status: payStatus === "succeeded" ? "paid" : "pending_payment",
        })
        .returning({ id: orders.id });
      await migrator.db.insert(payments).values({
        tenantId: s.tenantA,
        orderId: o!.id,
        provider: "stripe",
        providerRef: `cs_${randomUUID()}`,
        url: "https://pay.example.test/x",
        amountMinor: 1000n,
        currency: "EUR",
        status: payStatus,
        ...(payStatus === "succeeded" ? { verifiedBy: "webhook" as const, paidAt: at(-5) } : {}),
      });
    };
    await order(c2!, `O-${suffix}-2`, "succeeded");
    await order(c3!, `O-${suffix}-3`, "pending");

    const runs = aiRunListSchema.parse((await call("GET", "/ai/runs", "a")).json());
    expect(runs.items.find((i) => i.salesStage === "objections")).toMatchObject({ objection: "es-caro" });
    expect(runs.items.find((i) => i.text === "sin etapa")).toMatchObject({ salesStage: null, objection: null });

    const res = await call("GET", "/ai/runs/summary?days=7", "a");
    expect(res.statusCode).toBe(200);
    const sum = aiRunsSummarySchema.parse(res.json());
    const row = (list: typeof sum.byStage, key: string) => list.find((r) => r.key === key);
    expect(row(sum.byStage, "objections")).toMatchObject({ runs: 1, conversations: 1, quoteAccepted: 1, paidVerified: 0 });
    expect(row(sum.byStage, "closing")).toMatchObject({ runs: 2, conversations: 2, quoteAccepted: 0, paidVerified: 1 });
    // c4's quote was accepted BEFORE the run: not attributed.
    expect(row(sum.byStage, "discovery")).toMatchObject({ runs: 1, quoteAccepted: 0, paidVerified: 0 });
    expect(sum.byObjection).toEqual([{ key: "es-caro", runs: 1, conversations: 1, quoteAccepted: 1, paidVerified: 0 }]);

    // Other tenants and agents see nothing / are rejected.
    expect(aiRunsSummarySchema.parse((await call("GET", "/ai/runs/summary", "b")).json()).byStage).toEqual([]);
    expect((await call("GET", "/ai/runs/summary", "agent")).statusCode).toBe(403);
    expect((await call("GET", "/ai/runs/summary?days=0", "a")).statusCode).toBe(400);
  });
});
