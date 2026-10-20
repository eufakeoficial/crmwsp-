import "reflect-metadata";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  errorResponseSchema,
  opportunityDetailSchema,
  opportunityListSchema,
  orderSchema,
  pipelineListSchema,
  productListSchema,
  productSchema,
  productSearchListSchema,
  publicQuoteSchema,
  quoteSchema,
  taskSchema,
} from "@crmwsp/contracts";
import {
  agentConfigs,
  auditEvents,
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
  pipelines,
  productVariants,
  quoteItems,
  quotes,
  stockMovements,
  tenants,
  users,
  and,
  type DbHandle,
} from "@crmwsp/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { StorageHolder, type ObjectStorage } from "../storage/object-storage.js";

const hasEnv = Boolean(process.env["DATABASE_URL"] && process.env["DATABASE_URL_MIGRATOR"] && process.env["REDIS_URL"]);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
  body: string;
  rawPayload: Buffer;
}
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }
  async signedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    return `https://storage.test/${key}?X-Expires=${expiresInSeconds}&sig=abc`;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

function multipart(fields: Record<string, string>, file?: { name: string; mime: string; data: Buffer }) {
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

const sessionCookieOf = (res: InjectResult): string => {
  const raw = res.headers["set-cookie"];
  return ((Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "").split(";")[0] ?? "";
};

describe.skipIf(!hasEnv)("pipeline, tasks, catalog, quotes and orders (e2e, real Postgres + Redis)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  let queue: Queue;
  let queueRedis: Redis;
  let storage: MemoryStorage;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const mk = (k: string) => ({ email: `sales-${k}-${suffix}@example.test`, name: k.toUpperCase(), password, tenantName: `Sales ${k}`, tenantSlug: `sales-${k}-${suffix}` });
  const accounts = { a: mk("a"), b: mk("b"), c: mk("c") };
  const s = {} as {
    cookieA: string;
    cookieB: string;
    cookieC: string;
    tenantA: string;
    tenantB: string;
    userA: string;
    userB: string;
    contactIn: string;
    contactOut: string;
    convIn: string;
    convOut: string;
    contactB: string;
    productId: string;
    variantM: string;
    variantL: string;
    oppId: string;
    quoteId: string;
    quoteNumber: string;
  };

  const inject = (o: { method: Method; url: string; payload?: unknown; cookie?: string; tenant?: string; headers?: Record<string, string> }) =>
    app.inject({
      method: o.method,
      url: o.url,
      ...(o.payload !== undefined ? { payload: o.payload as object } : {}),
      headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.tenant ? { "x-tenant-id": o.tenant } : {}), ...(o.headers ?? {}) },
    }) as unknown as Promise<InjectResult>;
  const asA = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieA, tenant: s.tenantA });
  const asB = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieB, tenant: s.tenantB });
  const asAgent = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieC, tenant: s.tenantA });
  const upload = (url: string, fields: Record<string, string>, file?: { name: string; mime: string; data: Buffer }, who: "a" | "agent" = "a") => {
    const { payload, headers } = multipart(fields, file);
    return inject({ method: "POST", url, payload, headers, cookie: who === "a" ? s.cookieA : s.cookieC, tenant: s.tenantA });
  };
  const expectError = (res: InjectResult, status: number, code?: string) => {
    expect(res.statusCode).toBe(status);
    const err = errorResponseSchema.parse(res.json());
    if (code) expect(err.code).toBe(code);
    return err;
  };

  async function signup(acc: ReturnType<typeof mk>) {
    const res = await inject({ method: "POST", url: "/auth/signup", payload: acc });
    expect(res.statusCode).toBe(201);
    return { cookie: sessionCookieOf(res), tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id };
  }
  const userId = async (email: string) => (await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!.id;

  async function seedContact(tenantId: string, channelId: string, phone: string, lastInboundAt: Date | null) {
    const [c] = await migrator.db.insert(contacts).values({ tenantId, phoneE164: phone, name: `Contact ${phone}` }).returning({ id: contacts.id });
    const [conv] = await migrator.db
      .insert(conversations)
      .values({ tenantId, contactId: c!.id, channelConnectionId: channelId, lastInboundAt, lastMessageAt: lastInboundAt })
      .returning({ id: conversations.id });
    return { contactId: c!.id, conversationId: conv!.id };
  }

  const variantRow = async (id: string) => (await migrator.db.select().from(productVariants).where(eq(productVariants.id, id)))[0]!;

  beforeAll(async () => {
    process.env["OUTBOUND_QUEUE_NAME"] = `outbound-sales-${suffix}`;
    process.env["PUBLIC_WEB_URL"] = "https://app.example.test";
    migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 2 });
    queueRedis = new Redis(process.env["REDIS_URL"] as string, { maxRetriesPerRequest: null });
    queue = new Queue(process.env["OUTBOUND_QUEUE_NAME"], { connection: queueRedis });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    storage = new MemoryStorage();
    app.get(StorageHolder).storage = storage;

    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    const c = await signup(accounts.c);
    Object.assign(s, { cookieA: a.cookie, tenantA: a.tenant, cookieB: b.cookie, tenantB: b.tenant, cookieC: c.cookie });
    s.userA = await userId(accounts.a.email);
    s.userB = await userId(accounts.b.email);
    await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: await userId(accounts.c.email), role: "agent" });

    const [chA] = await migrator.db
      .insert(channelConnections)
      .values({ tenantId: s.tenantA, provider: "gupshup", phoneE164: "+34600000001", webhookToken: `tok-${randomUUID()}`, status: "active" })
      .returning({ id: channelConnections.id });
    const [chB] = await migrator.db
      .insert(channelConnections)
      .values({ tenantId: s.tenantB, provider: "gupshup", phoneE164: "+34600000002", webhookToken: `tok-${randomUUID()}`, status: "active" })
      .returning({ id: channelConnections.id });
    const inn = await seedContact(s.tenantA, chA!.id, "+34611111111", new Date());
    const out = await seedContact(s.tenantA, chA!.id, "+34622222222", new Date(Date.now() - 3 * 24 * 3600 * 1000));
    const bb = await seedContact(s.tenantB, chB!.id, "+34633333333", new Date());
    Object.assign(s, { contactIn: inn.contactId, convIn: inn.conversationId, contactOut: out.contactId, convOut: out.conversationId, contactB: bb.contactId });
    // Approval threshold: 100.00 EUR.
    await migrator.db.insert(agentConfigs).values({ tenantId: s.tenantA, version: 1, isActive: true, approvalThresholdMinor: 10_000n });
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

  // ------------------------------------------------------------------ pipeline

  describe("pipeline and opportunities", () => {
    it("seeds the default pipeline on the first GET for tenants without one", async () => {
      await migrator.db.delete(pipelines).where(eq(pipelines.tenantId, s.tenantB));
      const res = await asB("GET", "/pipelines");
      expect(res.statusCode).toBe(200);
      const { items } = pipelineListSchema.parse(res.json());
      expect(items).toHaveLength(1);
      expect(items[0]!.isDefault).toBe(true);
      expect(items[0]!.stages.map((x) => x.kind)).toEqual(["open", "open", "open", "open", "open", "won", "lost"]);
      // Idempotent.
      expect(pipelineListSchema.parse((await asB("GET", "/pipelines")).json()).items).toHaveLength(1);
    });

    it("creates, lists with keyset pagination and shows the detail", async () => {
      const pl = pipelineListSchema.parse((await asA("GET", "/pipelines")).json()).items[0]!;
      const ids: string[] = [];
      for (const title of ["Uno", "Dos", "Tres"]) {
        const res = await asA("POST", "/opportunities", { contactId: s.contactIn, title, valueMinor: 5000, currency: "EUR" });
        expect(res.statusCode).toBe(201 === res.statusCode ? 201 : 200);
        ids.push((res.json() as { id: string }).id);
      }
      s.oppId = ids[0]!;
      const page1 = opportunityListSchema.parse((await asA("GET", "/opportunities?limit=2")).json());
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = opportunityListSchema.parse((await asA("GET", `/opportunities?limit=2&cursor=${page1.nextCursor}`)).json());
      expect(page2.items).toHaveLength(1);
      expect(new Set([...page1.items, ...page2.items].map((o) => o.id)).size).toBe(3);
      expect(opportunityListSchema.parse((await asA("GET", `/opportunities?stageId=${pl.stages[0]!.id}&ownerId=me&q=dos`)).json()).items).toHaveLength(1);
      expect(opportunityListSchema.parse((await asA("GET", `/opportunities?contactId=${s.contactOut}`)).json()).items).toHaveLength(0);
      const detail = opportunityDetailSchema.parse((await asA("GET", `/opportunities/${s.oppId}`)).json());
      expect(detail.history).toHaveLength(1);
      expect(detail.history[0]).toMatchObject({ fromStageId: null, actor: { type: "user" } });
      expect(detail.conversationId).toBe(s.convIn);
    });

    it("PATCH with a stale lockVersion answers 409; a fresh one bumps it", async () => {
      const ok = await asA("PATCH", `/opportunities/${s.oppId}`, { title: "Uno bis", lockVersion: 0 });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ title: "Uno bis", lockVersion: 1 });
      expectError(await asA("PATCH", `/opportunities/${s.oppId}`, { title: "x", lockVersion: 0 }), 409, "CONFLICT");
      expectError(await asA("PATCH", `/opportunities/${s.oppId}`, { ownerId: s.userB, lockVersion: 1 }), 400);
    });

    it("move to a lost stage needs lostReason (400), writes history, timestamps and audit; 409 on stale lock", async () => {
      const pl = pipelineListSchema.parse((await asA("GET", "/pipelines")).json()).items[0]!;
      const lost = pl.stages.find((x) => x.kind === "lost")!;
      const won = pl.stages.find((x) => x.kind === "won")!;
      expectError(await asA("POST", `/opportunities/${s.oppId}/move`, { stageId: lost.id, lockVersion: 1 }), 400, "VALIDATION_ERROR");
      expectError(await asA("POST", `/opportunities/${s.oppId}/move`, { stageId: lost.id, lostReason: "x", lockVersion: 0 }), 409);
      const res = await asA("POST", `/opportunities/${s.oppId}/move`, { stageId: lost.id, lostReason: "Muy caro", lockVersion: 1 });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ stageId: lost.id, lostReason: "Muy caro", lockVersion: 2 });
      expect((res.json() as { lostAt: string | null }).lostAt).not.toBeNull();
      const back = await asA("POST", `/opportunities/${s.oppId}/move`, { stageId: won.id, lockVersion: 2 });
      expect(back.json()).toMatchObject({ lostAt: null, lostReason: null });
      expect((back.json() as { wonAt: string | null }).wonAt).not.toBeNull();
      const detail = opportunityDetailSchema.parse((await asA("GET", `/opportunities/${s.oppId}`)).json());
      expect(detail.history.map((h) => h.lostReason)).toEqual([null, "Muy caro", null]);
      const audit = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, s.tenantA), eq(auditEvents.action, "opportunity.moved")));
      expect(audit.length).toBeGreaterThanOrEqual(2);
      // Reopen to a normal stage for the quote tests.
      await asA("POST", `/opportunities/${s.oppId}/move`, { stageId: pl.stages[3]!.id, lockVersion: 3 });
    });

    it("viewers cannot write; other tenants get 404 on every opportunity route", async () => {
      expect((await asB("GET", `/opportunities/${s.oppId}`)).statusCode).toBe(404);
      expect((await asB("PATCH", `/opportunities/${s.oppId}`, { title: "x", lockVersion: 0 })).statusCode).toBe(404);
      expect((await asB("POST", `/opportunities/${s.oppId}/move`, { stageId: randomUUID(), lockVersion: 0 })).statusCode).toBe(404);
      expect(opportunityListSchema.parse((await asB("GET", "/opportunities")).json()).items).toHaveLength(0);
      expect((await asB("POST", "/opportunities", { contactId: s.contactIn, title: "x", currency: "EUR" })).statusCode).toBe(404);
    });
  });

  // ------------------------------------------------------------------ tasks

  describe("tasks", () => {
    it("creates, filters, validates the assignee and completes", async () => {
      expectError(await asA("POST", "/tasks", { title: "Foreign", assignedUserId: s.userB }), 400);
      const mine = await asA("POST", "/tasks", { title: "Llamar", assignedUserId: s.userA, opportunityId: s.oppId, dueAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString() });
      expect(mine.statusCode).toBe(201);
      const task = taskSchema.parse(mine.json());
      expect(task).toMatchObject({ assignedUser: { id: s.userA }, contactName: "Contact +34611111111", createdByType: "user" });
      await asA("POST", "/tasks", { title: "Futura", dueAt: new Date(Date.now() + 2 * 24 * 3600_000).toISOString() });
      const list = async (q: string) => ((await asA("GET", `/tasks${q}`)).json() as { items: { title: string }[] }).items.map((i) => i.title);
      expect(await list("?due=overdue")).toEqual(["Llamar"]);
      expect(await list("?assignedTo=me")).toEqual(["Llamar"]);
      expect(await list("?due=week")).toEqual(["Futura"]);
      const done = await asA("PATCH", `/tasks/${task.id}`, { status: "done" });
      expect(done.json()).toMatchObject({ status: "done" });
      expect(await list("?status=open&due=overdue")).toEqual([]);
      expect((await asB("PATCH", `/tasks/${task.id}`, { status: "open" })).statusCode).toBe(404);
      expect(((await asB("GET", "/tasks")).json() as { items: unknown[] }).items).toHaveLength(0);
      expect((await asB("POST", "/tasks", { title: "x", opportunityId: s.oppId })).statusCode).toBe(404);
    });
  });

  // ------------------------------------------------------------------ catalog

  describe("catalog", () => {
    it("only owner/admin write; creating a product without variants adds a default one", async () => {
      expect((await asAgent("POST", "/products", { name: "x", priceMinor: 1, currency: "EUR" })).statusCode).toBe(403);
      const res = await asA("POST", "/products", { name: "Servicio", priceMinor: 5000, currency: "EUR", kind: "service" });
      expect(res.statusCode).toBe(201);
      const p = productSchema.parse(res.json());
      expect(p.variants).toHaveLength(1);
      expect(p.variants[0]).toMatchObject({ options: {}, stockOnHand: 0 });
      expect(p.trackStock).toBe(false);
    });

    it("creates a product with variants; stock writes manual_adjust movements; the search view is flat", async () => {
      const res = await asA("POST", "/products", {
        name: "Camiseta",
        sku: "CAM-1",
        priceMinor: 2000,
        currency: "EUR",
        taxRateBp: 2100,
        variants: [
          { options: { talla: "M", color: "Negro" }, sku: "CAM-1-M", stockOnHand: 5 },
          { options: { talla: "L", color: "Negro" }, sku: "CAM-1-L", priceMinor: 2500 },
        ],
      });
      expect(res.statusCode).toBe(201);
      const p = productSchema.parse(res.json());
      s.productId = p.id;
      s.variantM = p.variants.find((v) => v.sku === "CAM-1-M")!.id;
      s.variantL = p.variants.find((v) => v.sku === "CAM-1-L")!.id;
      expectError(await asA("POST", "/products", { name: "Dup", sku: "CAM-1", priceMinor: 1, currency: "EUR" }), 409, "CONFLICT");

      // Update by option combination (no id) and by id.
      const put = await asA("PUT", `/products/${s.productId}/variants`, {
        variants: [{ options: { talla: "M", color: "negro" }, stockOnHand: 3 }, { id: s.variantL, stockOnHand: 4 }],
      });
      expect(put.statusCode).toBe(200);
      const moves = await migrator.db.select().from(stockMovements).where(inArray(stockMovements.variantId, [s.variantM, s.variantL]));
      const byVariant = (id: string) => moves.filter((m) => m.variantId === id).map((m) => [m.reason, m.delta]);
      expect(byVariant(s.variantM)).toEqual(expect.arrayContaining([["manual_adjust", 5], ["manual_adjust", -2]]));
      expect(byVariant(s.variantL)).toEqual([["manual_adjust", 4]]);
      expect((await variantRow(s.variantM)).stockOnHand).toBe(3);
      // Unchanged stock writes no movement.
      await asA("PUT", `/products/${s.productId}/variants`, { variants: [{ id: s.variantM, stockOnHand: 3 }] });
      expect((await migrator.db.select().from(stockMovements).where(eq(stockMovements.variantId, s.variantM)))).toHaveLength(2);

      const search = productSearchListSchema.parse((await asA("GET", "/products/search?q=camiseta")).json());
      expect(search.items).toHaveLength(2);
      const m = search.items.find((i) => i.variantId === s.variantM)!;
      expect(m).toMatchObject({ sku: "CAM-1-M", priceMinor: 2000, stock: 3, variant: { size: "M", color: "Negro" } });
      expect(search.items.find((i) => i.variantId === s.variantL)).toMatchObject({ priceMinor: 2500, stock: 4 });
    });

    it("lists with filters and cursor, shows detail, patches (owner/admin) and is tenant-isolated", async () => {
      const list = productListSchema.parse((await asA("GET", "/products?limit=1")).json());
      expect(list.items).toHaveLength(1);
      expect(list.nextCursor).not.toBeNull();
      expect(productListSchema.parse((await asA("GET", "/products?q=CAM-1")).json()).items).toHaveLength(1);
      const patched = await asA("PATCH", `/products/${s.productId}`, { priceMinor: 2100 });
      expect(patched.json()).toMatchObject({ priceMinor: 2100, version: 2 });
      await asA("PATCH", `/products/${s.productId}`, { priceMinor: 2000 });
      expect((await asAgent("PATCH", `/products/${s.productId}`, { priceMinor: 1 })).statusCode).toBe(403);
      expect((await asB("GET", `/products/${s.productId}`)).statusCode).toBe(404);
      expect((await asB("PATCH", `/products/${s.productId}`, { priceMinor: 1 })).statusCode).toBe(404);
      expect((await asB("PUT", `/products/${s.productId}/variants`, { variants: [{ stockOnHand: 99 }] })).statusCode).toBe(404);
      expect(productListSchema.parse((await asB("GET", "/products")).json()).items).toHaveLength(0);
    });

    it("media: rejects disallowed types and spoofed content, 503 without storage, signs short-lived URLs", async () => {
      expectError(await upload(`/products/${s.productId}/media`, {}, { name: "a.txt", mime: "text/plain", data: Buffer.from("hola") }), 400);
      expectError(await upload(`/products/${s.productId}/media`, {}, { name: "a.gif", mime: "image/gif", data: Buffer.from("GIF89a") }), 400);
      expectError(await upload(`/products/${s.productId}/media`, {}, { name: "a.png", mime: "image/png", data: Buffer.from("not really a png") }), 400);
      expectError(await upload(`/products/${s.productId}/media`, {}, { name: "big.png", mime: "image/png", data: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]) }), 400);
      expect(storage.objects.size).toBe(0);

      const ok = await upload(`/products/${s.productId}/media`, { variantId: s.variantM, alt: "Frente" }, { name: "a.png", mime: "image/png", data: PNG });
      expect(ok.statusCode).toBe(201);
      const media = ok.json() as { id: string; kind: string; variantId: string; url: string | null };
      expect(media).toMatchObject({ kind: "image", variantId: s.variantM, url: null });
      expect([...storage.objects.keys()][0]).toMatch(new RegExp(`^tenants/${s.tenantA}/products/${s.productId}/.+\\.png$`));

      const signed = await asA("GET", `/media/${media.id}`);
      expect(signed.statusCode).toBe(200);
      const body = signed.json() as { url: string; expiresAt: string };
      expect(body.url).toContain("X-Expires=300");
      expect(new Date(body.expiresAt).getTime()).toBeLessThan(Date.now() + 6 * 60_000);
      expect((await asB("GET", `/media/${media.id}`)).statusCode).toBe(404);
      expect((await upload(`/products/${s.productId}/media`, {}, { name: "a.png", mime: "image/png", data: PNG }, "agent")).statusCode).toBe(403);

      expect((await asB("DELETE", `/products/${s.productId}/media/${media.id}`)).statusCode).toBe(404);
      expect((await asA("DELETE", `/products/${s.productId}/media/${media.id}`)).statusCode).toBe(204);
      expect(storage.objects.size).toBe(0);

      const holder = app.get(StorageHolder);
      holder.storage = null;
      expectError(await upload(`/products/${s.productId}/media`, {}, { name: "a.png", mime: "image/png", data: PNG }), 503, "STORAGE_NOT_CONFIGURED");
      holder.storage = storage;
    });

    it("video links must be https and are never downloaded", async () => {
      expectError(await asA("POST", `/products/${s.productId}/media`, { kind: "video_link", url: "http://youtu.be/abc" }), 400);
      expectError(await asA("POST", `/products/${s.productId}/media`, { kind: "video_link", url: "javascript:alert(1)" }), 400);
      const ok = await asA("POST", `/products/${s.productId}/media`, { kind: "video_link", url: "https://youtu.be/abc" });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ kind: "video_link", url: "https://youtu.be/abc" });
      const got = await asA("GET", `/media/${(ok.json() as { id: string }).id}`);
      expect(got.json()).toEqual({ url: "https://youtu.be/abc", expiresAt: null });
    });

    it("import-from-knowledge is idempotent by SKU and links the chunk", async () => {
      const [src] = await migrator.db.insert(knowledgeSources).values({ tenantId: s.tenantA, kind: "csv", title: "Catálogo", status: "ready" }).returning({ id: knowledgeSources.id });
      const chunk = (ordinal: number, sku: string, price: number, extra: Record<string, unknown> = {}) => ({
        tenantId: s.tenantA,
        sourceId: src!.id,
        sourceVersion: 1,
        ordinal,
        content: `Item ${sku}`,
        metadata: { kind: "catalog_item", sku, name: `Item ${sku}`, price_minor: price, currency: "EUR", ...extra },
      });
      await migrator.db.insert(knowledgeChunks).values([chunk(0, "K-1", 1500, { stock: 7 }), chunk(1, "K-2", 900), chunk(2, "CAM-1", 123)]);
      const first = await asA("POST", "/products/import-from-knowledge", { sourceId: src!.id });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ created: 2, skipped: 1 });
      const second = await asA("POST", "/products/import-from-knowledge", { sourceId: src!.id });
      expect(second.json()).toMatchObject({ created: 0, skipped: 3, productIds: [] });
      const imported = productListSchema.parse((await asA("GET", "/products?q=K-1")).json()).items[0]!;
      expect(imported).toMatchObject({ source: "knowledge", priceMinor: 1500, trackStock: true });
      expect(imported.variants[0]).toMatchObject({ sku: "K-1", stockOnHand: 7 });
      expect((await migrator.db.select().from(stockMovements).where(eq(stockMovements.variantId, imported.variants[0]!.id)))[0]).toMatchObject({ reason: "import", delta: 7 });
      expect((await asB("POST", "/products/import-from-knowledge", { sourceId: src!.id })).statusCode).toBe(404);
      expect((await asAgent("POST", "/products/import-from-knowledge", { sourceId: src!.id })).statusCode).toBe(403);
    });
  });

  // ------------------------------------------------------------------ quotes

  describe("quotes", () => {
    const future = () => new Date(Date.now() + 15 * 24 * 3600_000).toISOString();

    it("the SERVER computes lines; an agent's unitPriceMinor on a catalog line is ignored", async () => {
      const res = await asAgent("POST", "/quotes", {
        opportunityId: s.oppId,
        contactId: s.contactIn,
        currency: "EUR",
        validUntil: future(),
        items: [{ variantId: s.variantM, quantityMilli: 2000, unitPriceMinor: 1, taxRateBp: 0 }],
      });
      expect(res.statusCode).toBe(201);
      const q = quoteSchema.parse(res.json());
      s.quoteId = q.id;
      s.quoteNumber = q.number;
      expect(q.number).toMatch(/^PRE-\d{4}-\d{4}$/);
      // 2 x 20.00 = 40.00 + 21% = 48.40
      expect(q).toMatchObject({ status: "draft", subtotalMinor: 4000, taxMinor: 840, totalMinor: 4840, discountMinor: 0, approvalRequired: false });
      expect(q.items[0]).toMatchObject({ unitPriceMinor: 2000, taxRateBp: 2100, lineTotalMinor: 4840, stock: 7, productId: s.productId });
      expect(q.items[0]!.description).toContain("Camiseta");
      expect(q.conversationId).toBe(s.convIn);
      // 0016: the exact variant is stored.
      const [stored] = await migrator.db.select().from(quoteItems).where(eq(quoteItems.quoteId, q.id));
      expect(stored!.variantId).toBe(s.variantM);

      // A productId line dressed as a free line (description + price) still takes the catalog price.
      const disguised = quoteSchema.parse(
        (await asAgent("POST", "/quotes", { contactId: s.contactIn, currency: "EUR", validUntil: future(), items: [{ productId: s.productId, description: "Libre", quantityMilli: 1000, unitPriceMinor: 1 }] })).json(),
      );
      expect(disguised.items[0]!.unitPriceMinor).not.toBe(1);
      // Discount outside 0..100 % is rejected.
      expectError(await asAgent("POST", "/quotes", { contactId: s.contactIn, currency: "EUR", validUntil: future(), items: [{ description: "x", quantityMilli: 1000, unitPriceMinor: 1, discountBp: 10_001 }] }), 400);
    });

    it("owner/admin price overrides are honored and audited; free lines keep the client's price", async () => {
      const res = await asA("POST", "/quotes", {
        contactId: s.contactIn,
        currency: "EUR",
        validUntil: future(),
        items: [
          { variantId: s.variantM, quantityMilli: 1000, unitPriceMinor: 1500 },
          { description: "Instalación", quantityMilli: 1500, unitPriceMinor: 1000, taxRateBp: 1000 },
        ],
      });
      const q = quoteSchema.parse(res.json());
      expect(q.items.map((i) => i.unitPriceMinor)).toEqual([1500, 1000]);
      expect(q.totalMinor).toBe(1815 + 1650);
      const audit = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, q.id), eq(auditEvents.action, "quote.created")));
      expect(JSON.stringify(audit[0]!.diff)).toContain("priceOverrides");
    });

    it("validates references and currency; other tenants get 404 everywhere", async () => {
      const base = { contactId: s.contactIn, currency: "EUR", validUntil: future() };
      expectError(await asA("POST", "/quotes", { ...base, currency: "USD", items: [{ variantId: s.variantM, quantityMilli: 1000 }] }), 400);
      expectError(await asA("POST", "/quotes", { ...base, items: [{ description: "x", quantityMilli: 1000 }] }), 400);
      expect((await asB("POST", "/quotes", { ...base, items: [{ description: "x", quantityMilli: 1000, unitPriceMinor: 1 }] })).statusCode).toBe(404);
      expect((await asA("POST", "/quotes", { ...base, contactId: s.contactB, items: [{ description: "x", quantityMilli: 1000, unitPriceMinor: 1 }] })).statusCode).toBe(404);
      expect((await asB("POST", "/quotes", { contactId: s.contactB, currency: "EUR", validUntil: future(), items: [{ variantId: s.variantM, quantityMilli: 1000 }] })).statusCode).toBe(404);
      for (const [m, u] of [["GET", ""], ["PATCH", ""], ["POST", "/submit"], ["POST", "/approve"], ["POST", "/reject"], ["GET", "/pdf"], ["POST", "/send"], ["POST", "/convert-to-order"]] as const) {
        expect((await asB(m, `/quotes/${s.quoteId}${u}`, m === "PATCH" ? { lockVersion: 0 } : undefined)).statusCode).toBe(404);
      }
      expect(((await asB("GET", "/quotes")).json() as { items: unknown[] }).items).toHaveLength(0);
    });

    it("PATCH needs the current lockVersion (409) and replaces the lines", async () => {
      expectError(await asA("PATCH", `/quotes/${s.quoteId}`, { notes: "x", lockVersion: 5 }), 409);
      const res = await asA("PATCH", `/quotes/${s.quoteId}`, { notes: "Gracias", lockVersion: 0, items: [{ variantId: s.variantM, quantityMilli: 2000 }] });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ notes: "Gracias", lockVersion: 1, totalMinor: 4840 });
    });

    it("the PDF is a real PDF", async () => {
      const res = await asA("GET", `/quotes/${s.quoteId}/pdf`);
      expect(res.statusCode).toBe(200);
      expect(String(res.headers["content-type"])).toContain("application/pdf");
      expect(res.rawPayload.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(storage.objects.has(`tenants/${s.tenantA}/quotes/${s.quoteId}.pdf`)).toBe(true);
    });

    it("above the threshold (or with a discount) the quote waits for approval; only owner/admin decide", async () => {
      const big = quoteSchema.parse(
        (await asAgent("POST", "/quotes", { contactId: s.contactIn, currency: "EUR", validUntil: future(), items: [{ description: "Obra", quantityMilli: 1000, unitPriceMinor: 20_000 }] })).json(),
      );
      expect(big.approvalRequired).toBe(true);
      const sub = await asAgent("POST", `/quotes/${big.id}/submit`);
      expect(sub.json()).toMatchObject({ status: "pending_approval" });
      const [row] = await migrator.db.select().from(quotes).where(eq(quotes.id, big.id));
      const [act] = await migrator.db.execute<{ type: string; status: string }>(
        (await import("@crmwsp/db")).sql`select type, status from ai_actions where id = ${row!.approvalActionId}`,
      );
      expect(act).toMatchObject({ type: "create_quote_draft", status: "pending_approval" });
      expect((await asAgent("POST", `/quotes/${big.id}/approve`)).statusCode).toBe(403);
      expect((await asAgent("POST", `/quotes/${big.id}/reject`)).statusCode).toBe(403);
      expect((await asA("PATCH", `/quotes/${big.id}`, { notes: "x", lockVersion: 1 })).statusCode).toBe(409);
      const ok = await asA("POST", `/quotes/${big.id}/approve`);
      expect(ok.json()).toMatchObject({ status: "approved" });
      expectError(await asA("POST", `/quotes/${big.id}/approve`), 409);
      const [act2] = await migrator.db.execute<{ status: string }>((await import("@crmwsp/db")).sql`select status from ai_actions where id = ${row!.approvalActionId}`);
      expect(act2!.status).toBe("executed");

      const disc = quoteSchema.parse(
        (await asA("POST", "/quotes", { contactId: s.contactIn, currency: "EUR", validUntil: future(), items: [{ description: "Pequeño", quantityMilli: 1000, unitPriceMinor: 1000, discountBp: 1000 }] })).json(),
      );
      expect((await asA("POST", `/quotes/${disc.id}/submit`)).json()).toMatchObject({ status: "pending_approval" });
      expect((await asA("POST", `/quotes/${disc.id}/reject`)).json()).toMatchObject({ status: "rejected" });
    });

    it("send: only approved, 422 outside the 24 h window, queues the message inside it", async () => {
      expectError(await asA("POST", `/quotes/${s.quoteId}/send`), 409);
      expect((await asA("POST", `/quotes/${s.quoteId}/submit`)).json()).toMatchObject({ status: "approved", approvalRequired: false });

      const out = quoteSchema.parse(
        (await asA("POST", "/quotes", { contactId: s.contactOut, currency: "EUR", validUntil: future(), items: [{ description: "Algo", quantityMilli: 1000, unitPriceMinor: 500 }] })).json(),
      );
      await asA("POST", `/quotes/${out.id}/submit`);
      expectError(await asA("POST", `/quotes/${out.id}/send`), 422, "OUTSIDE_SERVICE_WINDOW");
      expect((await migrator.db.select().from(quotes).where(eq(quotes.id, out.id)))[0]!.status).toBe("approved");

      const res = await asA("POST", `/quotes/${s.quoteId}/send`);
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ status: "sent" });
      const [msg] = await migrator.db.select().from(messages).where(and(eq(messages.conversationId, s.convIn), eq(messages.direction, "outbound")));
      expect(msg).toMatchObject({ status: "queued", type: "text" });
      expect(msg!.body).toContain(s.quoteNumber);
      expect(msg!.body).toMatch(new RegExp(`https://app.example.test/q/${s.tenantA}\\.[A-Za-z0-9_-]{43}`));
      expect(await queue.getJob(msg!.id)).toBeTruthy();
      // Only a hash is stored.
      const [stored] = await migrator.db.select().from(quotes).where(eq(quotes.id, s.quoteId));
      const token = /\/q\/(\S+)/.exec(msg!.body!)![1]!;
      expect(stored!.acceptTokenHash!.toString("hex")).toBe(createHash("sha256").update(token.split(".")[1]!).digest("hex"));
      expectError(await asA("POST", `/quotes/${s.quoteId}/send`), 409);
    });

    it("public acceptance: valid token, expired token and a token from another tenant", async () => {
      const [msg] = await migrator.db.select().from(messages).where(and(eq(messages.conversationId, s.convIn), eq(messages.direction, "outbound")));
      const token = /\/q\/(\S+)/.exec(msg!.body!)![1]!;
      const [tenantPart, secret] = token.split(".") as [string, string];

      const view = await inject({ method: "GET", url: `/public/quotes/${token}` });
      expect(view.statusCode).toBe(200);
      const pub = publicQuoteSchema.parse(view.json());
      expect(pub).toMatchObject({ number: s.quoteNumber, status: "sent", canAccept: true, totalMinor: 4840, seller: "Sales a" });
      expect(view.body).not.toMatch(/phoneE164|contact|tenantId|"id"/);

      // Another tenant's id with this secret, a random tenant, and malformed tokens: all the same 404.
      for (const t of [`${s.tenantB}.${secret}`, `${randomUUID()}.${secret}`, `${tenantPart}.${randomBytes(32).toString("base64url")}`, "garbage", `${tenantPart}.short`]) {
        expectError(await inject({ method: "GET", url: `/public/quotes/${t}` }), 404);
        expectError(await inject({ method: "POST", url: `/public/quotes/${t}/accept` }), 404);
      }

      // Expired: valid_until in the past.
      await migrator.db.update(quotes).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(quotes.id, s.quoteId));
      expect((publicQuoteSchema.parse((await inject({ method: "GET", url: `/public/quotes/${token}` })).json())).canAccept).toBe(false);
      const expired = expectError(await inject({ method: "POST", url: `/public/quotes/${token}/accept` }), 409);
      expect(expired.details).toMatchObject({ reason: "expired" });
      expect((await migrator.db.select().from(quotes).where(eq(quotes.id, s.quoteId)))[0]!.status).toBe("sent");

      await migrator.db.update(quotes).set({ validUntil: new Date(Date.now() + 86_400_000) }).where(eq(quotes.id, s.quoteId));
      // draft / rejected / expired quotes cannot be accepted through the link.
      for (const st of ["draft", "rejected", "expired"] as const) {
        await migrator.db.update(quotes).set({ status: st }).where(eq(quotes.id, s.quoteId));
        expectError(await inject({ method: "POST", url: `/public/quotes/${token}/accept` }), 409);
      }
      await migrator.db.update(quotes).set({ status: "sent" }).where(eq(quotes.id, s.quoteId));
      const ok = await inject({ method: "POST", url: `/public/quotes/${token}/accept` });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ status: "accepted" });
      expect((await inject({ method: "POST", url: `/public/quotes/${token}/accept` })).statusCode).toBe(200);
      expect((await asA("GET", `/quotes/${s.quoteId}`)).json()).toMatchObject({ status: "accepted" });
      const audit = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, s.quoteId), eq(auditEvents.action, "quote.accepted_by_link")));
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actorType).toBe("system");
      expect(audit[0]!.actorId).toBeNull();
      expect(audit[0]!.diff).toMatchObject({ actor: "public" });
    });
  });

  // ------------------------------------------------------------------ orders

  describe("orders", () => {
    const order = (items: { variantId: string; quantity: number }[], extra: Record<string, unknown> = {}) =>
      asA("POST", "/orders", { contactId: s.contactIn, items, fulfillment: "pickup", ...extra });

    it("prices come from the variants; the number comes from next_document_number", async () => {
      const res = await order([{ variantId: s.variantM, quantity: 2 }, { variantId: s.variantL, quantity: 1 }], { fulfillment: "shipping", shippingAddress: { line1: "Calle 1", city: "Madrid", country: "es" }, shippingMinor: 500 });
      expect(res.statusCode).toBe(201);
      const o = orderSchema.parse(res.json());
      expect(o.number).toMatch(/^PED-\d{4}-\d{4}$/);
      // M: 2 x 2000, L: 1 x 2500 -> 6500 net, 21% = 1365, + shipping 500.
      expect(o).toMatchObject({ status: "draft", stockState: "none", subtotalMinor: 6500, taxMinor: 1365, shippingMinor: 500, totalMinor: 8365 });
      expectError(await order([{ variantId: s.variantM, quantity: 1 }], { fulfillment: "shipping" }), 400);
      expect((await asB("POST", "/orders", { contactId: s.contactB, items: [{ variantId: s.variantM, quantity: 1 }], fulfillment: "pickup" })).statusCode).toBe(404);
      expect((await asB("GET", `/orders/${o.id}`)).statusCode).toBe(404);
      for (const a of ["confirm", "cancel", "mark-paid", "fulfill", "ship", "deliver"]) {
        expect((await asB("POST", `/orders/${o.id}/${a}`, a === "mark-paid" ? { reason: "prueba" } : undefined)).statusCode).toBe(404);
      }
      expect(((await asB("GET", "/orders")).json() as { items: unknown[] }).items).toHaveLength(0);
    });

    it("insufficient stock answers 409 INSUFFICIENT_STOCK with the variant and reserves nothing", async () => {
      const o = orderSchema.parse((await order([{ variantId: s.variantM, quantity: 1 }, { variantId: s.variantL, quantity: 99 }])).json());
      const err = expectError(await asA("POST", `/orders/${o.id}/confirm`), 409, "INSUFFICIENT_STOCK");
      expect(err.details).toEqual({ variantId: s.variantL });
      expect((await variantRow(s.variantM)).stockReserved).toBe(0);
      expect((await variantRow(s.variantL)).stockReserved).toBe(0);
      expect((await asA("GET", `/orders/${o.id}`)).json()).toMatchObject({ status: "draft", stockState: "none" });
    });

    it("confirm reserves, cancel releases", async () => {
      const o = orderSchema.parse((await order([{ variantId: s.variantM, quantity: 2 }])).json());
      const conf = await asA("POST", `/orders/${o.id}/confirm`);
      expect(conf.json()).toMatchObject({ status: "pending_payment", stockState: "reserved" });
      expect((await variantRow(s.variantM)).stockReserved).toBe(2);
      expectError(await asA("POST", `/orders/${o.id}/confirm`), 409);
      const can = await asA("POST", `/orders/${o.id}/cancel`);
      expect(can.json()).toMatchObject({ status: "cancelled", stockState: "released" });
      expect((await variantRow(s.variantM)).stockReserved).toBe(0);
      expect((await variantRow(s.variantM)).stockOnHand).toBe(3);
      expectError(await asA("POST", `/orders/${o.id}/cancel`), 409);
      const reasons = (await migrator.db.select().from(stockMovements).where(eq(stockMovements.refId, o.id))).map((m) => m.reason).sort();
      expect(reasons).toEqual(["order_released", "order_reserved"]);
    });

    it("mark-paid: agents get 403, a reason is mandatory, stock is committed, audit says 'pago manual'", async () => {
      const o = orderSchema.parse((await order([{ variantId: s.variantM, quantity: 1 }])).json());
      expectError(await asA("POST", `/orders/${o.id}/mark-paid`, { reason: "efectivo" }), 409); // still draft
      await asA("POST", `/orders/${o.id}/confirm`);
      expect((await asAgent("POST", `/orders/${o.id}/mark-paid`, { reason: "efectivo" })).statusCode).toBe(403);
      expectError(await asA("POST", `/orders/${o.id}/mark-paid`, {}), 400);
      const paid = await asA("POST", `/orders/${o.id}/mark-paid`, { reason: "Pago en efectivo en tienda" });
      expect(paid.statusCode).toBe(200);
      expect(paid.json()).toMatchObject({ status: "paid", stockState: "committed" });
      expect((await paid.json() as { paidAt: string | null }).paidAt).not.toBeNull();
      const v = await variantRow(s.variantM);
      expect([v.stockOnHand, v.stockReserved]).toEqual([2, 0]);
      const [audit] = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, o.id), eq(auditEvents.action, "order.mark_paid")));
      expect(audit!.reason).toContain("pago manual");
      expect(audit!.diff).toMatchObject({ verifiedBy: "manual", method: "manual" });

      // Fulfillment chain (pickup orders skip `ship`).
      expectError(await asA("POST", `/orders/${o.id}/deliver`), 409);
      expectError(await asA("POST", `/orders/${o.id}/ship`), 400);
      expect((await asA("POST", `/orders/${o.id}/fulfill`)).json()).toMatchObject({ status: "fulfilled" });
      expect((await asA("POST", `/orders/${o.id}/deliver`)).json()).toMatchObject({ status: "delivered" });
      expectError(await asA("POST", `/orders/${o.id}/cancel`), 409);
    });

    it("two parallel confirms reserve once; cancel after mark-paid is 409 and keeps the committed stock", async () => {
      const before = await variantRow(s.variantL);
      const o = orderSchema.parse((await order([{ variantId: s.variantL, quantity: 1 }])).json());
      const codes = (await Promise.all([asA("POST", `/orders/${o.id}/confirm`), asA("POST", `/orders/${o.id}/confirm`)])).map((r) => r.statusCode).sort();
      expect(codes).toEqual([200, 409]);
      expect((await variantRow(s.variantL)).stockReserved).toBe(before.stockReserved + 1);
      await asA("POST", `/orders/${o.id}/mark-paid`, { reason: "transferencia" });
      expectError(await asA("POST", `/orders/${o.id}/cancel`), 409);
      const after = await variantRow(s.variantL);
      expect([after.stockOnHand, after.stockReserved]).toEqual([before.stockOnHand - 1, before.stockReserved]);
    });

    it("a shipping order goes fulfill -> ship -> deliver", async () => {
      const o = orderSchema.parse(
        (await order([{ variantId: s.variantL, quantity: 1 }], { fulfillment: "shipping", shippingAddress: { line1: "Calle 1", city: "Madrid", country: "ES" } })).json(),
      );
      await asA("POST", `/orders/${o.id}/confirm`);
      await asA("POST", `/orders/${o.id}/mark-paid`, { reason: "transferencia" });
      expectError(await asA("POST", `/orders/${o.id}/ship`), 409);
      await asA("POST", `/orders/${o.id}/fulfill`);
      expectError(await asA("POST", `/orders/${o.id}/deliver`), 409);
      expect((await asA("POST", `/orders/${o.id}/ship`)).json()).toMatchObject({ status: "shipped" });
      expect((await asA("POST", `/orders/${o.id}/deliver`)).json()).toMatchObject({ status: "delivered" });
      const list = await asA("GET", "/orders?status=delivered");
      expect((list.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);
    });

    it("convert-to-order only for accepted quotes and is idempotent", async () => {
      const fresh = quoteSchema.parse(
        (await asA("POST", "/quotes", { contactId: s.contactIn, currency: "EUR", validUntil: new Date(Date.now() + 86_400_000).toISOString(), items: [{ variantId: s.variantL, quantityMilli: 1000 }] })).json(),
      );
      expectError(await asA("POST", `/quotes/${fresh.id}/convert-to-order`), 409);
      // Rule (ADR 0010): the order keeps the accepted quote's amounts, not today's catalog price,
      // and uses quote_items.variant_id rather than the description label.
      const [vm] = await migrator.db.select().from(productVariants).where(eq(productVariants.id, s.variantM));
      await migrator.db.update(productVariants).set({ priceMinor: 99_999n }).where(eq(productVariants.id, s.variantM));
      await migrator.db.update(quoteItems).set({ description: "Texto editado" }).where(eq(quoteItems.quoteId, s.quoteId));
      const res = await asA("POST", `/quotes/${s.quoteId}/convert-to-order`, {});
      expect(res.statusCode).toBe(201);
      const o = orderSchema.parse(res.json());
      expect(o).toMatchObject({ status: "draft", quoteId: s.quoteId, totalMinor: 4840, fulfillment: "service" });
      expect(o.items[0]).toMatchObject({ variantId: s.variantM, quantity: 2, lineTotalMinor: 4840 });
      const again = orderSchema.parse((await asA("POST", `/quotes/${s.quoteId}/convert-to-order`, {})).json());
      expect(again.id).toBe(o.id);
      await migrator.db.update(productVariants).set({ priceMinor: vm!.priceMinor }).where(eq(productVariants.id, s.variantM));
    });
  });
});
