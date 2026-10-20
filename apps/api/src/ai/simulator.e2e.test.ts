import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { aiScenarioListSchema, aiScenarioSchema, runScenariosResponseSchema, simulationResultSchema } from "@crmwsp/contracts";
import {
  aiActions,
  auditEvents,
  capiEvents,
  contacts,
  conversations,
  createDb,
  eq,
  followUps,
  inArray,
  inboundEvents,
  knowledgeChunks,
  knowledgeSources,
  memberships,
  messages,
  notifications,
  opportunities,
  orders,
  quotes,
  sql,
  tasks,
  tenants,
  usageLedger,
  users,
  webhookDeliveries,
  type DbHandle,
} from "@crmwsp/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { LlmProviderFactory } from "./llm-provider.factory.js";

const hasEnv = Boolean(process.env["DATABASE_URL"] && process.env["DATABASE_URL_MIGRATOR"] && process.env["REDIS_URL"]);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
  body: string;
}
type Method = "GET" | "POST" | "PUT" | "DELETE";

const sessionCookieOf = (res: InjectResult): string => {
  const raw = res.headers["set-cookie"];
  return ((Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "").split(";")[0] ?? "";
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Business tables a simulation must never write (the HARD RULE of F6). */
const SIDE_EFFECT_TABLES = {
  messages,
  conversations,
  contacts,
  aiActions,
  quotes,
  orders,
  tasks,
  opportunities,
  notifications,
  followUps,
  capiEvents,
  webhookDeliveries,
  inboundEvents,
  auditEvents,
} as const;

describe.skipIf(!hasEnv)("AI simulator (e2e, real Postgres + Redis, mocked LLM)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  let queue: Queue;
  let queueRedis: Redis;
  let factory: LlmProviderFactory;
  const suffix = randomUUID().slice(0, 8);
  const API_KEY = `sk-secret-${randomUUID()}`;
  const mk = (k: string) => ({
    email: `sim-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password: "correct-horse-battery",
    tenantName: `SIM ${k}`,
    tenantSlug: `sim-${k}-${suffix}`,
  });
  const accounts = { a: mk("a"), b: mk("b"), c: mk("c") };
  const s = {} as { cookieA: string; cookieB: string; cookieC: string; tenantA: string; tenantB: string; chunkId: string };
  let chatBodies: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  let modelOutput: Record<string, unknown> = {};

  const inject = (opts: { method: Method; url: string; payload?: unknown; cookie: string; tenant: string }): Promise<InjectResult> =>
    app.inject({
      method: opts.method,
      url: opts.url,
      ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
      headers: { cookie: opts.cookie, "x-tenant-id": opts.tenant },
    }) as unknown as Promise<InjectResult>;
  const asA = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieA, tenant: s.tenantA });
  const asB = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieB, tenant: s.tenantB });
  const asAgent = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieC, tenant: s.tenantA });

  async function signup(acc: ReturnType<typeof mk>): Promise<{ cookie: string; tenant: string }> {
    const res = (await app.inject({ method: "POST", url: "/auth/signup", payload: acc })) as unknown as InjectResult;
    expect(res.statusCode).toBe(201);
    return { cookie: sessionCookieOf(res), tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id };
  }

  async function sideEffectCounts(tenantId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [name, table] of Object.entries(SIDE_EFFECT_TABLES)) {
      const [row] = await migrator.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq((table as typeof messages).tenantId, tenantId));
      out[name] = row?.n ?? 0;
    }
    return out;
  }

  async function aiMessagesUsed(tenantId: string): Promise<number> {
    const rows = await migrator.db.execute<{ used: string }>(
      sql`select coalesce(sum(used), 0)::text as used from usage_counters where tenant_id = ${tenantId} and limit_key = 'ai_messages'`,
    );
    return Number(rows[0]?.used ?? 0);
  }

  beforeAll(async () => {
    process.env["ENCRYPTION_MASTER_KEY"] = randomBytes(32).toString("base64");
    process.env["ENCRYPTION_MASTER_KEY_ID"] = "1";
    process.env["AI_QUEUE_NAME"] = `ai-sim-test-${suffix}`;
    migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 2 });
    queueRedis = new Redis(process.env["REDIS_URL"] as string, { maxRetriesPerRequest: null });
    queue = new Queue(process.env["AI_QUEUE_NAME"], { connection: queueRedis });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    factory = app.get(LlmProviderFactory);
    factory.lookup = async () => [{ address: "93.184.216.34" }];
    factory.fetchImpl = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as (typeof chatBodies)[number];
        chatBodies.push(body);
        return jsonResponse({
          model: body.model,
          choices: [{ message: { content: JSON.stringify(modelOutput) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1200, completion_tokens: 300 },
        });
      }
      return jsonResponse({ error: { message: "not found" } }, 404);
    };

    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    const c = await signup(accounts.c);
    Object.assign(s, { cookieA: a.cookie, tenantA: a.tenant, cookieB: b.cookie, tenantB: b.tenant, cookieC: c.cookie });
    const [uc] = await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, accounts.c.email));
    await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: uc!.id, role: "agent" });

    const save = { provider: "openai", apiKey: API_KEY, modelCheap: "gpt-5-mini", modelStrong: "gpt-5" };
    expect((await asA("PUT", "/ai/connection", save)).statusCode).toBe(200);
    expect((await asA("PUT", "/ai/agent-config", { systemPrompt: "Eres el asistente de Fontanería Sol.", aiModeDefault: "auto", confidenceThreshold: 0.7, approvalThresholdMinor: null })).statusCode).toBe(200);

    const [src] = await migrator.db
      .insert(knowledgeSources)
      .values({ tenantId: s.tenantA, kind: "text", title: "Tarifas 2026", status: "ready" })
      .returning({ id: knowledgeSources.id });
    const [chunk] = await migrator.db
      .insert(knowledgeChunks)
      .values({ tenantId: s.tenantA, sourceId: src!.id, sourceVersion: 1, ordinal: 0, content: "servicio basico precio 50 EUR la hora" })
      .returning({ id: knowledgeChunks.id });
    s.chunkId = chunk!.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    queueRedis?.disconnect();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((x) => x.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((x) => x.email)));
      await migrator.close();
    }
  });

  const priceOutput = () => ({
    reply: { text: "El servicio básico cuesta 50 EUR la hora.", claims: [{ kind: "price", text: "50 EUR la hora", citations: [{ chunkId: s.chunkId }] }] },
    actions: [
      { type: "create_quote_draft", items: [{ chunkId: s.chunkId, quantity: 2 }] },
      { type: "apply_discount", percent: 80 },
      { type: "update_contact_field", field: "city", value: "Madrid", confidence: 0.95, sourceMessageId: "sim-1" },
      { type: "create_task", title: "Llamar al cliente" },
    ],
    confidence: 0.9,
    needsHuman: false,
    reason: "precio en la base",
  });

  it("only owner/admin may use the simulator and scenarios", async () => {
    expect((await asAgent("POST", "/ai/simulate", { messages: [{ author: "contact", text: "hola" }] })).statusCode).toBe(403);
    expect((await asAgent("GET", "/ai/scenarios")).statusCode).toBe(403);
    expect((await asAgent("POST", "/ai/scenarios/run", {})).statusCode).toBe(403);
  });

  it("rejects a conversation that does not end with a customer message", async () => {
    const res = await asA("POST", "/ai/simulate", { messages: [{ author: "ai", text: "hola" }] });
    expect(res.statusCode).toBe(400);
  });

  it("dry-runs a turn with ZERO side effects: no business rows, no queue jobs; usage booked as simulation", async () => {
    modelOutput = priceOutput();
    chatBodies = [];
    const before = await sideEffectCounts(s.tenantA);
    const usedBefore = await aiMessagesUsed(s.tenantA);
    const jobsBefore = await queue.getJobCounts();

    const res = await asA("POST", "/ai/simulate", { messages: [{ author: "contact", text: "servicio basico precio" }] });
    expect(res.statusCode).toBe(200);
    const r = simulationResultSchema.parse(res.json());

    expect(r.promptSource).toBe("active");
    expect(r.reply).toMatchObject({ outcome: "send" });
    expect(r.reply!.claims[0]!.citations[0]).toMatchObject({ chunkId: s.chunkId, valid: true, sourceTitle: "Tarifas 2026" });
    expect(r.actions.map((a) => [a.type, a.verdict])).toEqual([
      ["create_quote_draft", "needs_approval"],
      ["apply_discount", "blocked"],
      ["update_contact_field", "auto"],
      ["create_task", "auto"],
    ]);
    expect(r.usage).toMatchObject({ inputTokens: 1200, outputTokens: 300 });
    expect(r.retrievedChunks).toBe(1);
    expect(res.body).not.toContain(API_KEY);
    expect(chatBodies[0]!.messages[0]!.content).toContain("Fontanería Sol");

    expect(await sideEffectCounts(s.tenantA)).toEqual(before);
    expect(await queue.getJobCounts()).toEqual(jobsBefore);
    expect(await aiMessagesUsed(s.tenantA)).toBe(usedBefore + 1);
    const ledger = await migrator.db.select().from(usageLedger).where(eq(usageLedger.tenantId, s.tenantA));
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.every((l) => l.kind === "simulation" && l.refType === "simulation")).toBe(true);
  });

  it("uses the draft prompt when given and reports it", async () => {
    modelOutput = { actions: [], confidence: 0.3, needsHuman: true, reason: "no sé", reply: { text: "Te paso con alguien", claims: [] } };
    chatBodies = [];
    const res = await asA("POST", "/ai/simulate", {
      messages: [{ author: "contact", text: "hola" }, { author: "ai", text: "¿en qué te ayudo?" }, { author: "contact", text: "quiero una persona" }],
      draftSystemPrompt: "PROMPT BORRADOR XYZ",
    });
    expect(res.statusCode).toBe(200);
    const r = simulationResultSchema.parse(res.json());
    expect(r.promptSource).toBe("draft");
    expect(r.handoff).toBe(true);
    expect(r.reply!.outcome).toBe("blocked");
    const system = chatBodies[0]!.messages[0]!.content;
    expect(system).toContain("PROMPT BORRADOR XYZ");
    expect(system).not.toContain("Fontanería Sol");
  });

  it("scenarios: install defaults, CRUD, tenant isolation and Run all with pass/fail", async () => {
    const def = await asA("POST", "/ai/scenarios/defaults");
    expect(def.statusCode).toBe(200);
    expect(aiScenarioListSchema.parse(def.json()).items).toHaveLength(5);
    // Idempotent.
    expect(aiScenarioListSchema.parse((await asA("POST", "/ai/scenarios/defaults")).json()).items).toHaveLength(5);

    const created = await asA("POST", "/ai/scenarios", { name: "Precio con cita", messages: ["servicio basico precio"], expectations: ["must_cite_price", "must_not_handoff"] });
    expect(created.statusCode).toBe(201);
    const scn = aiScenarioSchema.parse(created.json());
    expect((await asB("PUT", `/ai/scenarios/${scn.id}`, { name: "x", messages: ["x"], expectations: ["must_reply"] })).statusCode).toBe(404);
    expect((await asB("DELETE", `/ai/scenarios/${scn.id}`)).statusCode).toBe(404);
    expect(aiScenarioListSchema.parse((await asB("GET", "/ai/scenarios")).json()).items).toHaveLength(0);
    const upd = await asA("PUT", `/ai/scenarios/${scn.id}`, { name: "Precio citado", messages: ["servicio basico precio"], expectations: ["must_cite_price", "must_not_handoff"] });
    expect(upd.statusCode).toBe(200);

    modelOutput = priceOutput();
    const before = await sideEffectCounts(s.tenantA);
    const run = await asA("POST", "/ai/scenarios/run", { scenarioIds: [scn.id] });
    expect(run.statusCode).toBe(200);
    const out = runScenariosResponseSchema.parse(run.json());
    expect(out).toMatchObject({ passed: 1, failed: 0 });

    // Run all: the uncited model output fails "must_cite_price" and passes "must_handoff".
    modelOutput = { actions: [], confidence: 0.9, needsHuman: false, reason: "r", reply: { text: "Cuesta 1 EUR", claims: [{ kind: "price", text: "1 EUR", citations: [] }] } };
    const all = runScenariosResponseSchema.parse((await asA("POST", "/ai/scenarios/run", {})).json());
    expect(all.results).toHaveLength(6);
    const byName = new Map(all.results.map((x) => [x.name, x]));
    expect(byName.get("Pregunta de precio")!.passed).toBe(false);
    expect(byName.get("Reclamación enfadada")!.passed).toBe(true);
    expect(all.passed + all.failed).toBe(6);
    expect(await sideEffectCounts(s.tenantA)).toEqual(before);

    expect((await asA("DELETE", `/ai/scenarios/${scn.id}`)).statusCode).toBe(204);
  });

  it("budget at cap: simulate refused with 402, nothing spent; Run all stops at the first refusal", async () => {
    const save = { provider: "openai", modelCheap: "gpt-5-mini", modelStrong: "gpt-5", monthlyBudgetMinor: 100, budgetCurrency: "USD" };
    expect((await asA("PUT", "/ai/connection", save)).statusCode).toBe(200);
    // 1 USD of real spend this month = 100 cents = the cap.
    await migrator.db.insert(usageLedger).values({
      tenantId: s.tenantA,
      kind: "llm_tokens",
      quantity: "1",
      unit: "tokens",
      costMinor: 100n * 1_000_000n,
      currency: "USD",
      meta: { unit: "usd_microcents" },
    });
    const ledgerCount = async () => (await migrator.db.select({ id: usageLedger.id }).from(usageLedger).where(eq(usageLedger.tenantId, s.tenantA))).length;
    const ledgerBefore = await ledgerCount();
    const usedBefore = await aiMessagesUsed(s.tenantA);
    chatBodies = [];

    const res = await asA("POST", "/ai/simulate", { messages: [{ author: "contact", text: "hola" }] });
    expect(res.statusCode).toBe(402);
    expect(res.body).toContain("budget_exceeded");
    expect(chatBodies).toHaveLength(0);
    expect(await ledgerCount()).toBe(ledgerBefore);
    expect(await aiMessagesUsed(s.tenantA)).toBe(usedBefore);

    const all = runScenariosResponseSchema.parse((await asA("POST", "/ai/scenarios/run", {})).json());
    expect(all.results.length).toBeGreaterThan(1);
    expect(all.results[0]!.error).toBe("budget_exceeded");
    expect(all.results.slice(1).every((r) => r.error === "not_run_budget_exceeded" && r.simulation === null)).toBe(true);
    expect(all.passed).toBe(0);
    expect(chatBodies).toHaveLength(0);
    expect(await ledgerCount()).toBe(ledgerBefore);
    expect(await aiMessagesUsed(s.tenantA)).toBe(usedBefore);
  });
});
