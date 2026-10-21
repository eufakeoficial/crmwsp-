import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  agentConfigSchema,
  aiActionItemListSchema,
  aiConnectionSchema,
  aiTestResultSchema,
  aiUsageSchema,
  errorResponseSchema,
  knowledgeConflictListSchema,
  knowledgeSourceListSchema,
  knowledgeSourceSchema,
} from "@crmwsp/contracts";
import {
  actionApprovals,
  agentConfigs,
  aiActions,
  and,
  auditEvents,
  channelConnections,
  contacts,
  conversations,
  createDb,
  eq,
  inArray,
  knowledgeChunks,
  llmConnections,
  memberships,
  tenants,
  usageLedger,
  users,
  type DbHandle,
} from "@crmwsp/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { LlmProviderFactory } from "../ai/llm-provider.factory.js";

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

/** Builds a multipart/form-data body by hand (no form-data dependency). */
function multipartBody(fields: Record<string, string>, file?: { name: string; mime: string; data: Buffer }) {
  const boundary = `----crmwsp${randomUUID().replace(/-/g, "")}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`),
      file.data,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe.skipIf(!hasEnv)("AI settings, knowledge and approvals (e2e, real Postgres + Redis)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  let queue: Queue;
  let queueRedis: Redis;
  let factory: LlmProviderFactory;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const API_KEY = `sk-secret-${randomUUID()}`;
  const mk = (k: string) => ({
    email: `ai-${k}-${suffix}@example.test`,
    name: k.toUpperCase(),
    password,
    tenantName: `AI ${k}`,
    tenantSlug: `ai-${k}-${suffix}`,
  });
  const accounts = { a: mk("a"), b: mk("b"), c: mk("c") };
  const s = {} as {
    cookieA: string;
    cookieB: string;
    cookieC: string;
    tenantA: string;
    tenantB: string;
    csvId: string;
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
  const asA = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieA, tenant: s.tenantA });
  const asB = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieB, tenant: s.tenantB });
  const asAgent = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieC, tenant: s.tenantA });
  const uploadAs = (who: "a" | "b" | "agent", fields: Record<string, string>, file?: { name: string; mime: string; data: Buffer }) => {
    const { payload, headers } = multipartBody(fields, file);
    const ctx = who === "a" ? { cookie: s.cookieA, tenant: s.tenantA } : who === "b" ? { cookie: s.cookieB, tenant: s.tenantB } : { cookie: s.cookieC, tenant: s.tenantA };
    return inject({ method: "POST", url: "/knowledge/sources", payload, headers, ...ctx });
  };
  const csv = (name: string, text: string) => ({ name, mime: "text/csv", data: Buffer.from(text, "utf8") });

  async function signup(acc: ReturnType<typeof mk>): Promise<{ cookie: string; tenant: string }> {
    const res = await inject({ method: "POST", url: "/auth/signup", payload: acc });
    expect(res.statusCode).toBe(201);
    return { cookie: sessionCookieOf(res), tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id };
  }

  const prevNodeEnv = process.env["NODE_ENV"];

  beforeAll(async () => {
    // The custom-baseUrl policy stubs DNS only under NODE_ENV=test; a NODE_ENV inherited from
    // .env or the shell (e.g. development) would resolve llm.example.com for real and fail.
    process.env["NODE_ENV"] = "test";
    // Test-only master key, never written to files.
    process.env["ENCRYPTION_MASTER_KEY"] = randomBytes(32).toString("base64");
    process.env["ENCRYPTION_MASTER_KEY_ID"] = "1";
    process.env["AI_QUEUE_NAME"] = `ai-test-${suffix}`;
    migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 2 });
    queueRedis = new Redis(process.env["REDIS_URL"] as string, { maxRetriesPerRequest: null });
    queue = new Queue(process.env["AI_QUEUE_NAME"], { connection: queueRedis });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    factory = app.get(LlmProviderFactory);
    factory.lookup = async () => [{ address: "93.184.216.34" }];

    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    const c = await signup(accounts.c);
    Object.assign(s, { cookieA: a.cookie, tenantA: a.tenant, cookieB: b.cookie, tenantB: b.tenant, cookieC: c.cookie });
    const [uc] = await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, accounts.c.email));
    await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: uc!.id, role: "agent" });
  });

  afterAll(async () => {
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
    if (app) await app.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    queueRedis?.disconnect();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((a) => a.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((a) => a.email)));
      await migrator.close();
    }
  });

  // -------------------------------------------------------------- connection

  describe("connection", () => {
    const save = { provider: "openai", apiKey: API_KEY, modelCheap: "gpt-5-mini", modelStrong: "gpt-5" };

    it("an agent gets 403 on every write and the viewer-level reads hide the hint", async () => {
      expect((await asAgent("PUT", "/ai/connection", save)).statusCode).toBe(403);
      expect((await asAgent("POST", "/ai/connection/test")).statusCode).toBe(403);
      expect((await asAgent("DELETE", "/ai/connection")).statusCode).toBe(403);
      expect((await asAgent("PUT", "/ai/agent-config", { systemPrompt: "", aiModeDefault: "auto", confidenceThreshold: 0.5, approvalThresholdMinor: null })).statusCode).toBe(403);
      expect((await asAgent("GET", "/ai/connection")).statusCode).toBe(200);
    });

    it("GET is null before connecting; first save without a key is rejected", async () => {
      const res = await asA("GET", "/ai/connection");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toBeNull();
      const noKey = await asA("PUT", "/ai/connection", { ...save, apiKey: undefined });
      expect(noKey.statusCode).toBe(400);
    });

    it("saves with a fixed base URL, encrypts the key and never returns it", async () => {
      const res = await asA("PUT", "/ai/connection", { ...save, baseUrl: "https://evil.example.com/v1", monthlyBudgetMinor: 2000, budgetCurrency: "EUR" });
      expect(res.statusCode).toBe(200);
      const dto = aiConnectionSchema.parse(res.json());
      expect(dto).toMatchObject({ provider: "openai", baseUrl: "https://api.openai.com/v1", apiKeyHint: `••••${API_KEY.slice(-4)}`, monthlyBudgetMinor: 2000, budgetCurrency: "EUR" });
      expect(res.body).not.toContain(API_KEY);

      const get = await asA("GET", "/ai/connection");
      expect(get.body).not.toContain(API_KEY);
      // The agent never sees the hint either.
      expect((await asAgent("GET", "/ai/connection")).json()).toMatchObject({ apiKeyHint: null });

      const [row] = await migrator.db.select().from(llmConnections).where(eq(llmConnections.tenantId, s.tenantA));
      expect(row!.apiKeyEncrypted!.toString("utf8")).not.toContain(API_KEY);
      expect(row!.apiKeyEncrypted!.length).toBeGreaterThan(80);
      const audit = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, s.tenantA), eq(auditEvents.entity, "llm_connection")));
      expect(audit.map((a) => a.action)).toContain("llm_connection.created");
      expect(JSON.stringify(audit)).not.toContain(API_KEY);
    });

    it("keeps the stored key when apiKey is omitted on update", async () => {
      const res = await asA("PUT", "/ai/connection", { provider: "openrouter", modelCheap: "openai/gpt-5-mini", modelStrong: "openai/gpt-5" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyHint: `••••${API_KEY.slice(-4)}`, monthlyBudgetMinor: null });
      // PUT replaces the whole connection (budget included): back to openai with the budget for the tests below.
      const back = await asA("PUT", "/ai/connection", { ...save, apiKey: undefined, monthlyBudgetMinor: 2000, budgetCurrency: "EUR" });
      expect(back.statusCode).toBe(200);
    });

    it("test uses the stored key, persists capabilities and never exposes the key", async () => {
      const seen: Array<{ url: string; auth: string | null }> = [];
      factory.fetchImpl = async (input, init) => {
        const url = String(input);
        seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
        if (url.endsWith("/chat/completions")) {
          return jsonResponse({ model: "gpt-5-mini", choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
        }
        if (url.endsWith("/embeddings")) return jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 1 } });
        return jsonResponse({ error: { message: "not found" } }, 404);
      };
      const res = await asA("POST", "/ai/connection/test");
      expect(res.statusCode).toBe(200);
      const result = aiTestResultSchema.parse(res.json());
      expect(result.ok).toBe(true);
      expect(result.capabilities).toEqual({ structuredOutput: true, embeddings: true, transcription: false });
      expect(res.body).not.toContain(API_KEY);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((r) => r.url.startsWith("https://api.openai.com/v1/") && r.auth === `Bearer ${API_KEY}`)).toBe(true);

      const get = aiConnectionSchema.parse((await asA("GET", "/ai/connection")).json());
      expect(get.capabilities).toEqual({ structuredOutput: true, embeddings: true, transcription: false });
      expect(get.lastTestOk).toBe(true);
      expect(get.lastTestedAt).not.toBeNull();
    });

    it("test never answers 500 on provider failures: ok:false with a sanitized error", async () => {
      factory.fetchImpl = async () => jsonResponse({ error: { message: `Incorrect API key provided: ${API_KEY}` } }, 401);
      const res = await asA("POST", "/ai/connection/test");
      expect(res.statusCode).toBe(200);
      const result = aiTestResultSchema.parse(res.json());
      expect(result.ok).toBe(false);
      expect(res.body).not.toContain(API_KEY);
      const get = aiConnectionSchema.parse((await asA("GET", "/ai/connection")).json());
      expect(get).toMatchObject({ lastTestOk: false });

      factory.fetchImpl = async () => {
        throw new Error(`socket hang up ${API_KEY}`);
      };
      const boom = await asA("POST", "/ai/connection/test");
      expect(boom.statusCode).toBe(200);
      expect(boom.body).not.toContain(API_KEY);
      expect(aiTestResultSchema.parse(boom.json()).ok).toBe(false);
    });

    it("custom providers pass the anti-SSRF policy: private IPs and http are 400, a public https host is saved", async () => {
      const base = { provider: "custom", apiKey: "sk-custom-12345678", modelCheap: "m1", modelStrong: "m2" };
      for (const baseUrl of ["https://10.0.0.1", "https://10.0.0.1/v1", "http://llm.example.com/v1", "https://localhost/v1", "https://169.254.169.254/latest"]) {
        const res = await asB("PUT", "/ai/connection", { ...base, baseUrl });
        expect(res.statusCode, baseUrl).toBe(400);
        expect(errorResponseSchema.parse(res.json()).code).toBe("VALIDATION_ERROR");
      }
      expect((await asB("PUT", "/ai/connection", base)).statusCode).toBe(400);
      const ok = await asB("PUT", "/ai/connection", { ...base, baseUrl: "https://llm.example.com/v1/" });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ provider: "custom", baseUrl: "https://llm.example.com/v1" });
    });

    it("tenant B never sees the connection of tenant A", async () => {
      const b = aiConnectionSchema.parse((await asB("GET", "/ai/connection")).json());
      expect(b.baseUrl).toBe("https://llm.example.com/v1");
      const del = await asB("DELETE", "/ai/connection");
      expect(del.statusCode).toBe(204);
      expect((await asB("GET", "/ai/connection")).json()).toBeNull();
      expect(aiConnectionSchema.safeParse((await asA("GET", "/ai/connection")).json()).success).toBe(true);
    });
  });

  // ------------------------------------------------------------------- usage

  describe("usage and agent config", () => {
    it("sums tenant_monthly_spend in the reporting currency", async () => {
      const at = new Date("2026-03-15T12:00:00Z");
      await migrator.db.insert(usageLedger).values([
        { tenantId: s.tenantA, kind: "llm_tokens", quantity: "1000", unit: "tokens", costMinor: 1234n, currency: "EUR", occurredAt: at },
        { tenantId: s.tenantA, kind: "embedding_tokens", quantity: "500", unit: "tokens", costMinor: 100n, currency: "EUR", occurredAt: at },
        { tenantId: s.tenantA, kind: "llm_tokens", quantity: "10", unit: "tokens", costMinor: 999n, currency: "USD", occurredAt: at },
        { tenantId: s.tenantB, kind: "llm_tokens", quantity: "10", unit: "tokens", costMinor: 777n, currency: "EUR", occurredAt: at },
        // Worker rows: USD micro-cents, one with an unverified price.
        { tenantId: s.tenantA, kind: "llm_tokens", quantity: "10", unit: "tokens", costMinor: 5_000_000n, currency: "USD", occurredAt: at, meta: { unit: "usd_microcents", verified: false } },
      ]);
      const res = await asA("GET", "/ai/usage?month=2026-03");
      expect(res.statusCode).toBe(200);
      const usage = aiUsageSchema.parse(res.json());
      // EUR budget: USD micro-cents are NOT converted (no FX) -> flagged; unverified prices -> estimated.
      expect(usage).toMatchObject({ spentMinor: 1334, currency: "EUR", budgetMinor: 2000, currencyMismatch: true, estimated: true });
      expect(usage.byKind).toEqual(expect.arrayContaining([{ kind: "llm_tokens", costMinor: 1234 }, { kind: "embedding_tokens", costMinor: 100 }]));
      expect(aiUsageSchema.parse((await asA("GET", "/ai/usage?month=2026-04")).json()).spentMinor).toBe(0);
      expect((await asA("GET", "/ai/usage?month=2026-13")).statusCode).toBe(400);
      // B only sees its own ledger.
      expect(aiUsageSchema.parse((await asB("GET", "/ai/usage?month=2026-03")).json())).toMatchObject({ spentMinor: 777, budgetMinor: null, currencyMismatch: false, estimated: false });
      // USD tenant: micro-cents convert to cents (200_000_000 = 2 USD) and add to plain cents.
      await migrator.db.update(tenants).set({ currency: "USD" }).where(eq(tenants.id, s.tenantB));
      await migrator.db.insert(usageLedger).values([
        { tenantId: s.tenantB, kind: "embedding_tokens", quantity: "1", unit: "tokens", costMinor: 200_000_000n, currency: "USD", occurredAt: at, meta: { unit: "usd_microcents", verified: true } },
        { tenantId: s.tenantB, kind: "embedding_tokens", quantity: "1", unit: "tokens", costMinor: 30n, currency: "USD", occurredAt: at },
      ]);
      expect(aiUsageSchema.parse((await asB("GET", "/ai/usage?month=2026-03")).json())).toMatchObject({
        currency: "USD", spentMinor: 230, currencyMismatch: false, estimated: false, byKind: [{ kind: "embedding_tokens", costMinor: 230 }],
      });
    });

    it("returns defaults, saves versions and keeps a single active row", async () => {
      expect(agentConfigSchema.parse((await asA("GET", "/ai/agent-config")).json())).toMatchObject({ aiModeDefault: "assist", approvalThresholdMinor: null });
      const next = { systemPrompt: "Be brief.", aiModeDefault: "auto", confidenceThreshold: 0.8, approvalThresholdMinor: 50_000 };
      expect((await asA("PUT", "/ai/agent-config", next)).statusCode).toBe(200);
      expect((await asA("PUT", "/ai/agent-config", { ...next, confidenceThreshold: 0.6 })).statusCode).toBe(200);
      expect(agentConfigSchema.parse((await asA("GET", "/ai/agent-config")).json())).toEqual({ ...next, confidenceThreshold: 0.6 });
      const rows = await migrator.db.select().from(agentConfigs).where(eq(agentConfigs.tenantId, s.tenantA));
      expect(rows.map((r) => r.version).sort()).toEqual([1, 2]);
      expect(rows.filter((r) => r.isActive).map((r) => r.version)).toEqual([2]);
      expect((await asA("PUT", "/ai/agent-config", { ...next, confidenceThreshold: 2 })).statusCode).toBe(400);
      expect(agentConfigSchema.parse((await asB("GET", "/ai/agent-config")).json()).systemPrompt).toBe("");
    });
  });

  // --------------------------------------------------------------- knowledge

  describe("knowledge", () => {
    const catalog1 = "nombre;precio;sku\nCable HDMI;12,50;CAB-1\nTubo cobre;30;TUB-1\n";

    it("uploads a CSV (tenant currency as default), creates source + chunks and enqueues embed-source", async () => {
      const res = await uploadAs("a", { kind: "csv" }, csv("precios.csv", catalog1));
      expect(res.statusCode).toBe(201);
      const src = knowledgeSourceSchema.parse(res.json());
      expect(src).toMatchObject({ kind: "csv", title: "precios.csv", status: "ready", version: 1, chunkCount: 2 });
      s.csvId = src.id;

      const chunks = await migrator.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, src.id));
      expect(chunks).toHaveLength(2);
      expect(chunks.every((c) => c.embedding === null && c.tenantId === s.tenantA)).toBe(true);
      expect(chunks.find((c) => c.metadata.sku === "CAB-1")!.metadata).toMatchObject({ price_minor: 1250, currency: "EUR" });

      const job = await queue.getJob(`embed-${src.id}`);
      expect(job?.name).toBe("embed-source");
      expect(job?.data).toEqual({ tenantId: s.tenantA, sourceId: src.id });

      const list = knowledgeSourceListSchema.parse((await asA("GET", "/knowledge/sources")).json());
      expect(list.items.map((i) => i.id)).toContain(src.id);
      const audit = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, src.id), eq(auditEvents.action, "knowledge_source.created")));
      expect(audit).toHaveLength(1);
    });

    it("uploading the same CSV again is idempotent", async () => {
      const again = await uploadAs("a", { kind: "csv" }, csv("otro-nombre.csv", catalog1));
      expect(again.statusCode).toBe(200);
      expect(knowledgeSourceSchema.parse(again.json())).toMatchObject({ id: s.csvId, chunkCount: 2 });
      const all = await migrator.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.tenantId, s.tenantA));
      expect(all.filter((c) => c.sourceId === s.csvId)).toHaveLength(2);
      // Concurrent identical uploads also collapse into one source.
      const text = "nombre;precio\nSoporte TV;45\n";
      const [r1, r2] = await Promise.all([uploadAs("a", { kind: "csv" }, csv("c.csv", text)), uploadAs("a", { kind: "csv" }, csv("c.csv", text))]);
      expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 201]);
      expect((r1.json() as { id: string }).id).toBe((r2.json() as { id: string }).id);
    });

    it("an ambiguous currency is a 422 with per-row errors and creates nothing", async () => {
      const before = (await migrator.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.tenantId, s.tenantA))).length;
      const res = await uploadAs("a", { kind: "csv" }, csv("mala.csv", "nombre;precio;moneda\nCable;12,50;\nTubo;Bs 400;\nValvula;$ 30;\n"));
      expect(res.statusCode).toBe(422);
      const err = errorResponseSchema.parse(res.json());
      expect(err.code).toBe("VALIDATION_ERROR");
      const details = err.details as { errors: Array<{ line: number; reason: string }>; totalErrors: number };
      // Line 3 ("Bs 400") is unambiguous; lines 2 (blank) and 4 ("$") are not.
      expect(details.totalErrors).toBe(2);
      expect(details.errors.map((e) => e.line)).toEqual([2, 4]);
      expect((await migrator.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.tenantId, s.tenantA))).length).toBe(before);
    });

    it("caps the error summary at 50 rows", async () => {
      const rows = Array.from({ length: 80 }, (_, i) => `Item ${i};abc`).join("\n");
      const res = await uploadAs("a", { kind: "csv" }, csv("basura.csv", `nombre;precio;moneda\n${rows}\n`));
      expect(res.statusCode).toBe(422);
      const details = errorResponseSchema.parse(res.json()).details as { errors: unknown[]; totalErrors: number };
      expect(details.errors).toHaveLength(50);
      expect(details.totalErrors).toBe(80);
    });

    it("validates the upload: kind, MIME type, empty and oversized files, agents", async () => {
      expect((await uploadAs("a", { kind: "faq" }, csv("x.csv", catalog1))).statusCode).toBe(400);
      expect((await uploadAs("a", { kind: "csv" }, { name: "x.csv", mime: "image/png", data: Buffer.from(catalog1) })).statusCode).toBe(400);
      expect((await uploadAs("a", { kind: "pdf" }, csv("x.pdf", catalog1))).statusCode).toBe(400);
      expect((await uploadAs("a", { kind: "csv" })).statusCode).toBe(400);
      expect((await uploadAs("a", { kind: "csv" }, csv("e.csv", ""))).statusCode).toBe(400);
      const fakePdf = await uploadAs("a", { kind: "pdf" }, { name: "x.pdf", mime: "application/pdf", data: Buffer.from("not a pdf") });
      expect(fakePdf.statusCode).toBe(422);
      const big = await uploadAs("a", { kind: "csv" }, { name: "big.csv", mime: "text/csv", data: Buffer.alloc(16 * 1024 * 1024, 97) });
      expect(big.statusCode).toBe(400);
      expect((await uploadAs("agent", { kind: "csv" }, csv("a.csv", "nombre;precio\nZ;1,00 EUR\n"))).statusCode).toBe(403);
    });

    it("creates FAQ and text sources from JSON", async () => {
      const faq = await asA("POST", "/knowledge/sources", { kind: "faq", title: "Preguntas", content: "P: ¿Horario?\nR: 9 a 18.\n\nP: ¿Garantía?\nR: Dos años." });
      expect(faq.statusCode).toBe(201);
      expect(knowledgeSourceSchema.parse(faq.json())).toMatchObject({ kind: "faq", title: "Preguntas", chunkCount: 2 });
      const text = await asA("POST", "/knowledge/sources", { kind: "text", title: "Política", content: "Aceptamos devoluciones en 30 días." });
      expect(text.statusCode).toBe(201);
      const empty = await asA("POST", "/knowledge/sources", { kind: "faq", title: "Vacía", content: "sin pares" });
      expect(empty.statusCode).toBe(422);
      expect((await asA("POST", "/knowledge/sources", { kind: "csv", title: "x", content: "y" })).statusCode).toBe(400);
    });

    it("detects a price conflict between two CSVs", async () => {
      expect(knowledgeConflictListSchema.parse((await asA("GET", "/knowledge/conflicts")).json()).items).toEqual([]);
      const second = await uploadAs("a", { kind: "csv" }, csv("tarifa-antigua.csv", "nombre;precio;sku\nCable HDMI;10,00;CAB-1\n"));
      expect(second.statusCode).toBe(201);
      const conflicts = knowledgeConflictListSchema.parse((await asA("GET", "/knowledge/conflicts")).json()).items;
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.key).toBe("CAB-1");
      expect(conflicts[0]!.sources.map((x) => [x.title, x.priceMinor, x.currency]).sort()).toEqual([
        ["precios.csv", 1250, "EUR"],
        ["tarifa-antigua.csv", 1000, "EUR"],
      ]);
      // Tenant B sees nothing.
      expect(knowledgeConflictListSchema.parse((await asB("GET", "/knowledge/conflicts")).json()).items).toEqual([]);
    });

    it("tenant B cannot see or delete the sources of tenant A (404)", async () => {
      expect(knowledgeSourceListSchema.parse((await asB("GET", "/knowledge/sources")).json()).items).toEqual([]);
      expect((await asB("DELETE", `/knowledge/sources/${s.csvId}`)).statusCode).toBe(404);
      expect((await asB("DELETE", "/knowledge/sources/not-a-uuid")).statusCode).toBe(404);
      // The same file uploaded by B is its own source (hash lookup is per tenant).
      const b = await uploadAs("b", { kind: "csv" }, csv("precios.csv", catalog1));
      expect(b.statusCode).toBe(201);
      expect((b.json() as { id: string }).id).not.toBe(s.csvId);
    });

    it("deletes a source with its chunks (agents cannot)", async () => {
      expect((await inject({ method: "DELETE", url: `/knowledge/sources/${s.csvId}`, cookie: s.cookieC, tenant: s.tenantA })).statusCode).toBe(403);
      expect((await asA("DELETE", `/knowledge/sources/${s.csvId}`)).statusCode).toBe(204);
      expect(await migrator.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, s.csvId))).toHaveLength(0);
      expect((await asA("DELETE", `/knowledge/sources/${s.csvId}`)).statusCode).toBe(404);
      const audit = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, s.csvId), eq(auditEvents.action, "knowledge_source.deleted")));
      expect(audit).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------------- actions

  describe("approvals", () => {
    const ids = {} as { pendingA: string; pendingA2: string; doneA: string; pendingB: string; conv: string; draft: string };

    beforeAll(async () => {
      const [chunk] = await migrator.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.tenantId, s.tenantA)).limit(1);
      const [chan] = await migrator.db
        .insert(channelConnections)
        .values({ tenantId: s.tenantA, provider: "gupshup", phoneE164: "+34600000777", externalAppId: "App", webhookToken: randomBytes(32).toString("base64url"), status: "active" })
        .returning({ id: channelConnections.id });
      const [contact] = await migrator.db.insert(contacts).values({ tenantId: s.tenantA, phoneE164: "+34611111111", name: "María López" }).returning({ id: contacts.id });
      const [conv] = await migrator.db.insert(conversations).values({ tenantId: s.tenantA, contactId: contact!.id, channelConnectionId: chan!.id }).returning({ id: conversations.id });
      ids.conv = conv!.id;
      const base = { decision: "approve" as const, status: "pending_approval" as const };
      const [p1, p2, d1] = await migrator.db
        .insert(aiActions)
        .values([
          { tenantId: s.tenantA, type: "apply_discount", payload: { percent: 15 }, decisionReason: "Above threshold", conversationId: ids.conv, citations: [{ chunkId: chunk!.id, sourceId: chunk!.sourceId, sourceVersion: 1 }, { chunkId: randomUUID(), sourceId: randomUUID(), sourceVersion: 1 }], ...base },
          { tenantId: s.tenantA, type: "send_template", payload: { templateName: "recordatorio" }, ...base },
          { tenantId: s.tenantA, type: "move_stage", payload: { stage: "won" }, decision: "auto", status: "executed" },
        ])
        .returning({ id: aiActions.id });
      const [dr] = await migrator.db
        .insert(aiActions)
        .values({ tenantId: s.tenantA, type: "draft_reply", payload: { text: "Hola, claro." }, decision: "auto", status: "proposed", conversationId: ids.conv })
        .returning({ id: aiActions.id });
      ids.draft = dr!.id;
      const [pb] = await migrator.db.insert(aiActions).values({ tenantId: s.tenantB, type: "handoff", payload: {}, ...base }).returning({ id: aiActions.id });
      Object.assign(ids, { pendingA: p1!.id, pendingA2: p2!.id, doneA: d1!.id, pendingB: pb!.id });
    });

    it("lists actions with contactName, reason and citations; filters by status; isolates tenants", async () => {
      const pending = aiActionItemListSchema.parse((await asA("GET", "/ai/actions?status=pending_approval")).json()).items;
      expect(pending.map((a) => a.id).sort()).toEqual([ids.pendingA, ids.pendingA2].sort());
      const first = pending.find((a) => a.id === ids.pendingA)!;
      expect(first).toMatchObject({ type: "apply_discount", contactName: "María López", conversationId: ids.conv, reason: "Above threshold", payload: { percent: 15 } });
      expect(first.citations).toHaveLength(2);
      expect(first.citations[0]!.title).toBeTruthy(); // enriched from the (existing) chunk
      expect(first.citations[1]!.title).toBeUndefined(); // dangling citation: id only
      expect(aiActionItemListSchema.parse((await asA("GET", "/ai/actions")).json()).items).toHaveLength(4);
      // Assist-mode drafts from the worker: filter by status + type + conversation.
      const drafts = aiActionItemListSchema.parse((await asA("GET", `/ai/actions?status=proposed&type=draft_reply&conversationId=${ids.conv}`)).json()).items;
      expect(drafts.map((d) => d.id)).toEqual([ids.draft]);
      expect(drafts[0]).toMatchObject({ type: "draft_reply", status: "proposed", payload: { text: "Hola, claro." } });
      expect(aiActionItemListSchema.parse((await asA("GET", `/ai/actions?type=draft_reply&conversationId=${randomUUID()}`)).json()).items).toEqual([]);
      expect((await asA("GET", "/ai/actions?conversationId=nope")).statusCode).toBe(400);
      expect((await asA("GET", "/ai/actions?status=bogus")).statusCode).toBe(400);
      expect(aiActionItemListSchema.parse((await asB("GET", "/ai/actions")).json()).items.map((a) => a.id)).toEqual([ids.pendingB]);
      // B cannot decide A's action: 404, and nothing changes.
      expect((await asB("POST", `/ai/actions/${ids.pendingA}/approve`)).statusCode).toBe(404);
      expect((await asB("POST", `/ai/actions/${ids.pendingA}/reject`)).statusCode).toBe(404);
      const [row] = await migrator.db.select().from(aiActions).where(eq(aiActions.id, ids.pendingA));
      expect(row!.status).toBe("pending_approval");
    });

    it("agents cannot approve or reject (403)", async () => {
      expect((await asAgent("POST", `/ai/actions/${ids.pendingA}/approve`)).statusCode).toBe(403);
      expect((await asAgent("POST", `/ai/actions/${ids.pendingA}/reject`)).statusCode).toBe(403);
    });

    it("approve records the decision, audits it, does not execute, and enqueues execute-ai-action", async () => {
      const res = await asA("POST", `/ai/actions/${ids.pendingA}/approve`, { note: "ok por mí" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: ids.pendingA, status: "approved" });
      const [row] = await migrator.db.select().from(aiActions).where(eq(aiActions.id, ids.pendingA));
      expect(row).toMatchObject({ status: "approved", executedAt: null, result: null });
      const approvals = await migrator.db.select().from(actionApprovals).where(eq(actionApprovals.actionId, ids.pendingA));
      expect(approvals).toHaveLength(1);
      expect(approvals[0]).toMatchObject({ decision: "approved", note: "ok por mí", tenantId: s.tenantA });
      const audit = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, ids.pendingA), eq(auditEvents.action, "ai_action.approved")));
      expect(audit).toHaveLength(1);
      expect(audit[0]!.diff).toMatchObject({ status: { from: "pending_approval", to: "approved" } });
      const job = await queue.getJob(`execute-${ids.pendingA}`);
      expect(job?.name).toBe("execute-ai-action");
      expect(job?.data).toEqual({ tenantId: s.tenantA, actionId: ids.pendingA });
    });

    it("any further decision on a decided or executed action is 409 and writes nothing", async () => {
      for (const [id, verb] of [[ids.pendingA, "approve"], [ids.pendingA, "reject"], [ids.doneA, "approve"], [ids.doneA, "reject"]] as const) {
        const res = await asA("POST", `/ai/actions/${id}/${verb}`);
        expect(res.statusCode, `${id} ${verb}`).toBe(409);
        expect(errorResponseSchema.parse(res.json()).code).toBe("CONFLICT");
      }
      expect(await migrator.db.select().from(actionApprovals).where(eq(actionApprovals.actionId, ids.pendingA))).toHaveLength(1);
      expect(await migrator.db.select().from(actionApprovals).where(eq(actionApprovals.actionId, ids.doneA))).toHaveLength(0);
    });

    it("reject records the decision and audit, enqueues nothing", async () => {
      const res = await asA("POST", `/ai/actions/${ids.pendingA2}/reject`, { note: "no procede" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: ids.pendingA2, status: "rejected" });
      const approvals = await migrator.db.select().from(actionApprovals).where(eq(actionApprovals.actionId, ids.pendingA2));
      expect(approvals).toMatchObject([{ decision: "rejected", note: "no procede" }]);
      const audit = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, ids.pendingA2), eq(auditEvents.action, "ai_action.rejected")));
      expect(audit).toHaveLength(1);
      expect(await queue.getJob(`execute-${ids.pendingA2}`)).toBeUndefined();
      expect((await asA("POST", `/ai/actions/${ids.pendingA2}/approve`)).statusCode).toBe(409);
    });

    it("unknown ids are 404 and a bad note is 400", async () => {
      expect((await asA("POST", `/ai/actions/${randomUUID()}/approve`)).statusCode).toBe(404);
      expect((await asA("POST", "/ai/actions/nope/reject")).statusCode).toBe(404);
      expect((await asB("POST", `/ai/actions/${ids.pendingB}/approve`, { note: "x".repeat(1001) })).statusCode).toBe(400);
      expect((await asB("POST", `/ai/actions/${ids.pendingB}/approve`)).statusCode).toBe(200);
    });
  });

  describe("realtime hub forwards worker AI events", () => {
    it("delivers ai.* and message.created events published by the worker, drops unknown ones", async () => {
      const hub = app.get(RealtimeHub);
      const got: Array<Record<string, unknown>> = [];
      const unsubscribe = await hub.subscribe(s.tenantA, (e) => got.push(e as unknown as Record<string, unknown>));
      const conversationId = randomUUID();
      const actionId = randomUUID();
      const events = [
        { type: "ai.reply_drafted", conversationId, actionId },
        { type: "ai.action_pending", conversationId, actionId },
        { type: "ai.handoff", conversationId, actionId },
        { type: "ai.budget_warning", connectionId: randomUUID(), month: "2026-10" },
        { type: "message.created", conversationId, messageId: randomUUID() },
        { type: "ai.bogus", conversationId },
      ];
      const pub = new Redis(process.env["REDIS_URL"] as string);
      for (const e of events) await pub.publish(`tenant:${s.tenantA}:events`, JSON.stringify(e));
      const end = Date.now() + 3000;
      while (got.length < 5 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 150));
      pub.disconnect();
      unsubscribe();
      expect(got.map((e) => e["type"])).toEqual(["ai.reply_drafted", "ai.action_pending", "ai.handoff", "ai.budget_warning", "message.created"]);
    });
  });
});
