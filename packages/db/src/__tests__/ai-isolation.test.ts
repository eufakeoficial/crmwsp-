import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle, type Transaction } from "../client.js";
import { runMigrations } from "../migrate.js";
import {
  actionApprovals,
  agentConfigs,
  aiActions,
  knowledgeChunks,
  knowledgeSources,
  llmConnections,
  memberships,
  tenants,
  usageLedger,
  users,
} from "../schema/index.js";
import { searchChunks, searchChunksText } from "../knowledge-search.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

type PgCause = { code?: string; message?: string };
const pgCause = (err: unknown): PgCause | undefined =>
  (err as Error & { cause?: PgCause } | undefined)?.cause ?? (err as PgCause | undefined);
const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

interface Seed {
  tenant: string;
  user: string;
  llm: string;
  agent: string;
  source: string;
  chunk: string;
  action: string;
  approval: string;
  usage: string;
}

describe.skipIf(!hasDb)("AI, knowledge and usage tables RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: Seed;
  let B: Seed;

  // A and B chunks share words and vectors, so only RLS can tell them apart.
  async function seed(label: string, vec: number[]): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ slug: `ai-${label}-${suffix}`, name: `Tenant ${label}` })
        .returning({ id: tenants.id });
      const [u] = await tx
        .insert(users)
        .values({ email: `ai-${label}-${suffix}@example.test`, name: label })
        .returning({ id: users.id });
      if (!t || !u) throw new Error("seed failed");
      await tx.insert(memberships).values({ tenantId: t.id, userId: u.id, role: "owner" });
      const [llm] = await tx
        .insert(llmConnections)
        .values({
          tenantId: t.id,
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEncrypted: Buffer.from(`secret-${label}`),
          apiKeyHint: "…abcd",
          modelCheap: "gpt-4o-mini",
          capabilities: { structuredOutput: true, embeddings: true },
          isActive: true,
        })
        .returning({ id: llmConnections.id });
      const [ag] = await tx
        .insert(agentConfigs)
        .values({ tenantId: t.id, version: 1, systemPrompt: "hi", isActive: true, createdBy: u.id })
        .returning({ id: agentConfigs.id });
      const [src] = await tx
        .insert(knowledgeSources)
        .values({ tenantId: t.id, kind: "csv", title: "Catalog", status: "ready", contentHash: "h" })
        .returning({ id: knowledgeSources.id });
      if (!llm || !ag || !src) throw new Error("seed failed");
      const [ch] = await tx
        .insert(knowledgeChunks)
        .values({
          tenantId: t.id,
          sourceId: src.id,
          sourceVersion: 1,
          ordinal: 0,
          content: `precio tornillo ${label}`,
          metadata: { sku: `SKU-${label}`, price_minor: 100, currency: "EUR" },
          embedding: vec,
          embeddingModel: "test-3d",
          embeddingDims: 3,
        })
        .returning({ id: knowledgeChunks.id });
      if (!ch) throw new Error("seed failed");
      const [ac] = await tx
        .insert(aiActions)
        .values({
          tenantId: t.id,
          type: "send_quote",
          payload: { amount: 1 },
          citations: [{ chunkId: ch.id, sourceId: src.id, sourceVersion: 1 }],
          confidence: "0.9",
          decision: "approve",
          status: "pending_approval",
          model: "gpt-4o-mini",
        })
        .returning({ id: aiActions.id });
      if (!ac) throw new Error("seed failed");
      const [ap] = await tx
        .insert(actionApprovals)
        .values({ tenantId: t.id, actionId: ac.id, decidedBy: u.id, decision: "approved" })
        .returning({ id: actionApprovals.id });
      const [us] = await tx
        .insert(usageLedger)
        .values({
          tenantId: t.id,
          kind: "llm_tokens",
          quantity: "1000",
          unit: "tokens",
          costMinor: 7n,
          currency: "EUR",
          meta: { model: "gpt-4o-mini" },
        })
        .returning({ id: usageLedger.id });
      if (!ap || !us) throw new Error("seed failed");
      return {
        tenant: t.id,
        user: u.id,
        llm: llm.id,
        agent: ag.id,
        source: src.id,
        chunk: ch.id,
        action: ac.id,
        approval: ap.id,
        usage: us.id,
      };
    });
  }

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    A = await seed("a", [1, 0, 0]);
    B = await seed("b", [1, 0, 0.01]);
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [A?.tenant, B?.tenant].filter((x): x is string => Boolean(x));
      const uids = [A?.user, B?.user].filter((x): x is string => Boolean(x));
      if (ids.length) await migrator.db.delete(tenants).where(inArray(tenants.id, ids));
      if (uids.length) await migrator.db.delete(users).where(inArray(users.id, uids));
      await migrator.close();
    }
    if (app) await app.close();
  });

  const tables = [
    { name: "llm_connections", table: llmConnections, key: "llm", appendOnly: false },
    { name: "agent_configs", table: agentConfigs, key: "agent", appendOnly: false },
    { name: "knowledge_sources", table: knowledgeSources, key: "source", appendOnly: false },
    { name: "knowledge_chunks", table: knowledgeChunks, key: "chunk", appendOnly: false },
    { name: "ai_actions", table: aiActions, key: "action", appendOnly: false },
    { name: "action_approvals", table: actionApprovals, key: "approval", appendOnly: true },
    { name: "usage_ledger", table: usageLedger, key: "usage", appendOnly: true },
  ] as const;

  for (const { name, table, key, appendOnly } of tables) {
    it(`${name}: tenant A only sees its rows and cannot modify B's`, async () => {
      const rows = await withTenant(app.db, A.tenant, (tx) =>
        tx.select({ id: table.id, tenantId: table.tenantId }).from(table),
      );
      expect(rows.map((r) => r.id)).toContain(A[key]);
      expect(rows.every((r) => r.tenantId === A.tenant)).toBe(true);

      const none = await app.db.select({ id: table.id }).from(table);
      expect(none).toHaveLength(0);

      const updated = await settle(
        withTenant(app.db, A.tenant, (tx) =>
          tx.update(table).set({ tenantId: A.tenant }).where(eq(table.id, B[key])).returning({ id: table.id }),
        ),
      );
      if (appendOnly) expect(pgCause(updated)?.code).toBe("42501");
      const upd = appendOnly
        ? []
        : await withTenant(app.db, A.tenant, (tx) =>
            tx.update(table).set({ tenantId: A.tenant }).where(eq(table.id, B[key])).returning({ id: table.id }),
          );
      expect(upd).toHaveLength(0);

      if (appendOnly) {
        const del = await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(table).where(eq(table.id, B[key]))));
        expect(pgCause(del)?.code).toBe("42501");
      } else {
        const del = await withTenant(app.db, A.tenant, (tx) =>
          tx.delete(table).where(eq(table.id, B[key])).returning({ id: table.id }),
        );
        expect(del).toHaveLength(0);
      }
      const [still] = await migrator.db.select({ t: table.tenantId }).from(table).where(eq(table.id, B[key]));
      expect(still?.t).toBe(B.tenant);
    });
  }

  it("cannot insert rows with another tenant's tenant_id (WITH CHECK)", async () => {
    const inserts = [
      (tx: Transaction) =>
        tx.insert(llmConnections).values({ tenantId: B.tenant, provider: "custom", baseUrl: "https://x", modelCheap: "m" }),
      (tx: Transaction) => tx.insert(agentConfigs).values({ tenantId: B.tenant, version: 99 }),
      (tx: Transaction) => tx.insert(knowledgeSources).values({ tenantId: B.tenant, kind: "faq", title: "x" }),
      (tx: Transaction) =>
        tx.insert(knowledgeChunks).values({ tenantId: B.tenant, sourceId: B.source, sourceVersion: 1, ordinal: 9, content: "x" }),
      (tx: Transaction) => tx.insert(aiActions).values({ tenantId: B.tenant, type: "x", decision: "deny" }),
      (tx: Transaction) =>
        tx.insert(actionApprovals).values({ tenantId: B.tenant, actionId: B.action, decidedBy: B.user, decision: "rejected" }),
      (tx: Transaction) =>
        tx.insert(usageLedger).values({ tenantId: B.tenant, kind: "wa_message", quantity: "1", unit: "msg", currency: "EUR" }),
    ];
    for (const ins of inserts) {
      const err = await settle(withTenant(app.db, A.tenant, ins));
      expect(err).toBeInstanceOf(Error);
      expect(pgCause(err)?.code).toBe("42501");
    }
  });

  it("llm_connections: only one active connection per tenant", async () => {
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(llmConnections).values({
          tenantId: A.tenant,
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          modelCheap: "deepseek-chat",
          isActive: true,
        }),
      ),
    );
    expect(pgCause(err)?.code).toBe("23505");
    const inactive = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .insert(llmConnections)
        .values({ tenantId: A.tenant, provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", modelCheap: "m" })
        .returning({ id: llmConnections.id }),
    );
    expect(inactive).toHaveLength(1);
    const badProvider = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.execute(sql`insert into llm_connections (tenant_id, provider, base_url, model_cheap)
                       values (${A.tenant}, 'anthropic-direct', 'https://x', 'm')`),
      ),
    );
    expect(pgCause(badProvider)?.code).toBe("23514");
  });

  it("agent_configs: unique version and one active per tenant", async () => {
    const dupVersion = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(agentConfigs).values({ tenantId: A.tenant, version: 1 })),
    );
    expect(pgCause(dupVersion)?.code).toBe("23505");
    const secondActive = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(agentConfigs).values({ tenantId: A.tenant, version: 2, isActive: true })),
    );
    expect(pgCause(secondActive)?.code).toBe("23505");
    const [v2] = await withTenant(app.db, A.tenant, (tx) =>
      tx.insert(agentConfigs).values({ tenantId: A.tenant, version: 2 }).returning(),
    );
    expect(v2?.isActive).toBe(false);
    expect(v2?.confidenceThreshold).toBe("0.75");
    // Same version number in another tenant is fine.
    const [bv2] = await withTenant(app.db, B.tenant, (tx) =>
      tx.insert(agentConfigs).values({ tenantId: B.tenant, version: 2 }).returning({ id: agentConfigs.id }),
    );
    expect(bv2?.id).toBeDefined();
  });

  for (const { name, table, key } of [
    { name: "action_approvals", table: actionApprovals, key: "approval" },
    { name: "usage_ledger", table: usageLedger, key: "usage" },
  ] as const) {
    it(`${name} is append-only for its own rows (UPDATE/DELETE/TRUNCATE → 42501)`, async () => {
      const upd = await settle(
        withTenant(app.db, A.tenant, (tx) => tx.update(table).set({ tenantId: A.tenant }).where(eq(table.id, A[key]))),
      );
      expect(pgCause(upd)?.code).toBe("42501");
      const del = await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(table).where(eq(table.id, A[key]))));
      expect(pgCause(del)?.code).toBe("42501");
      const trunc = await settle(withTenant(app.db, A.tenant, (tx) => tx.execute(sql.raw(`truncate ${name}`))));
      expect(pgCause(trunc)?.code).toBe("42501");
      const [row] = await migrator.db.select({ id: table.id }).from(table).where(eq(table.id, A[key]));
      expect(row?.id).toBe(A[key]);
    });
  }

  it("action_approvals and usage_ledger accept inserts for the own tenant", async () => {
    const ap = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .insert(actionApprovals)
        .values({ tenantId: A.tenant, actionId: A.action, decidedBy: A.user, decision: "rejected", note: "no" })
        .returning({ id: actionApprovals.id }),
    );
    expect(ap).toHaveLength(1);
  });

  it("vector search with withTenant(A) only returns A's chunks", async () => {
    // B's vector is the closest one to the query; RLS must still hide it.
    const query = "[1,0,0.01]";
    const rows = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .select({ id: knowledgeChunks.id, tenantId: knowledgeChunks.tenantId })
        .from(knowledgeChunks)
        .where(sql`${knowledgeChunks.embedding} IS NOT NULL AND ${knowledgeChunks.embeddingDims} = 3`)
        .orderBy(sql`${knowledgeChunks.embedding} <=> ${query}::vector`)
        .limit(10),
    );
    expect(rows.map((r) => r.id)).toEqual([A.chunk]);
    const [b] = await withTenant(app.db, B.tenant, (tx) =>
      tx
        .select({ id: knowledgeChunks.id, embedding: knowledgeChunks.embedding })
        .from(knowledgeChunks)
        .orderBy(sql`${knowledgeChunks.embedding} <=> ${query}::vector`)
        .limit(1),
    );
    expect(b?.id).toBe(B.chunk);
    expect(b?.embedding).toEqual([1, 0, 0.01]);
  });

  it("full-text search with withTenant(A) only returns A's chunks", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .select({ id: knowledgeChunks.id })
        .from(knowledgeChunks)
        .where(sql`to_tsvector('simple', ${knowledgeChunks.content}) @@ plainto_tsquery('simple', ${"precio tornillo"})`),
    );
    expect(rows.map((r) => r.id)).toEqual([A.chunk]);
    const bOnly = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .select({ id: knowledgeChunks.id })
        .from(knowledgeChunks)
        .where(sql`to_tsvector('simple', ${knowledgeChunks.content}) @@ plainto_tsquery('simple', ${"b"})`),
    );
    expect(bOnly).toHaveLength(0);
  });

  it("api_key_encrypted of B is not readable from tenant A", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) =>
      tx.select({ key: llmConnections.apiKeyEncrypted }).from(llmConnections).where(eq(llmConnections.id, B.llm)),
    );
    expect(rows).toHaveLength(0);
    const raw = await withTenant(app.db, A.tenant, (tx) =>
      tx.execute(sql`select api_key_encrypted from llm_connections where tenant_id = ${B.tenant}`),
    );
    expect(raw).toHaveLength(0);
    const [own] = await withTenant(app.db, A.tenant, (tx) =>
      tx.select({ key: llmConnections.apiKeyEncrypted }).from(llmConnections).where(eq(llmConnections.id, A.llm)),
    );
    expect(own?.key?.toString()).toBe("secret-a");
  });

  it("tenant_monthly_spend sums only the current tenant's ledger", async () => {
    await withTenant(app.db, A.tenant, (tx) =>
      tx.insert(usageLedger).values({
        tenantId: A.tenant,
        kind: "llm_tokens",
        quantity: "500",
        unit: "tokens",
        costMinor: 3n,
        currency: "EUR",
        occurredAt: new Date("2000-01-15T00:00:00Z"),
      }),
    );
    type Row = { currency: string; kind: string; cost_minor: string; quantity: string };
    const now = await withTenant(app.db, A.tenant, (tx) =>
      tx.execute<Row>(sql`select * from tenant_monthly_spend(now())`),
    );
    expect([...now]).toEqual([{ currency: "EUR", kind: "llm_tokens", cost_minor: "7", quantity: "1000" }]);
    // Tenant timezone is Europe/Madrid (default, UTC+1 in winter): 22:00Z on
    // Jan 31 is still January; 23:30Z is already February 1st locally.
    const old = await withTenant(app.db, A.tenant, (tx) =>
      tx.execute<Row>(sql`select * from tenant_monthly_spend('2000-01-31T22:00:00Z'::timestamptz)`),
    );
    expect([...old]).toEqual([{ currency: "EUR", kind: "llm_tokens", cost_minor: "3", quantity: "500" }]);
    await withTenant(app.db, A.tenant, (tx) =>
      tx.insert(usageLedger).values({
        tenantId: A.tenant,
        kind: "llm_tokens",
        quantity: "10",
        unit: "tokens",
        costMinor: 1n,
        currency: "EUR",
        occurredAt: new Date("2000-01-31T23:30:00Z"),
      }),
    );
    const feb = await withTenant(app.db, A.tenant, (tx) =>
      tx.execute<Row>(sql`select * from tenant_monthly_spend('2000-02-10T00:00:00Z'::timestamptz)`),
    );
    expect([...feb]).toEqual([{ currency: "EUR", kind: "llm_tokens", cost_minor: "1", quantity: "10" }]);
    const janAgain = await withTenant(app.db, A.tenant, (tx) =>
      tx.execute<Row>(sql`select * from tenant_monthly_spend('2000-01-01T12:00:00Z'::timestamptz)`),
    );
    expect([...janAgain]).toEqual([{ currency: "EUR", kind: "llm_tokens", cost_minor: "3", quantity: "500" }]);
    const noTenant = await app.sql`select * from tenant_monthly_spend(now())`;
    expect(noTenant).toHaveLength(0);
  });

  describe("composite FKs reject links to another tenant's rows (23503)", () => {
    let bConversation: string;
    let bMessage: string;

    beforeAll(async () => {
      const rows = await migrator.sql<{ conv: string; msg: string }[]>`
        with ch as (
          insert into channel_connections (tenant_id, provider, phone_e164, webhook_token)
          values (${B.tenant}, 'gupshup', '+34600000001', ${`ai-fk-${suffix}`}) returning id
        ), ct as (
          insert into contacts (tenant_id, phone_e164) values (${B.tenant}, '+34600000002') returning id
        ), cv as (
          insert into conversations (tenant_id, contact_id, channel_connection_id)
          select ${B.tenant}, ct.id, ch.id from ct, ch returning id
        ), m as (
          insert into messages (tenant_id, conversation_id, direction, type, status, author)
          select ${B.tenant}, cv.id, 'inbound', 'text', 'received', 'contact' from cv returning id, conversation_id
        )
        select conversation_id as conv, id as msg from m`;
      const [r] = rows;
      if (!r) throw new Error("seed failed");
      bConversation = r.conv;
      bMessage = r.msg;
    });

    const cases: { name: string; run: (tx: Transaction) => Promise<unknown> }[] = [
      {
        name: "knowledge_chunks.source_id",
        run: (tx) =>
          tx.insert(knowledgeChunks).values({
            tenantId: A.tenant,
            sourceId: B.source,
            sourceVersion: 1,
            ordinal: 9,
            content: "x",
          }),
      },
      {
        name: "action_approvals.action_id",
        run: (tx) =>
          tx
            .insert(actionApprovals)
            .values({ tenantId: A.tenant, actionId: B.action, decidedBy: A.user, decision: "approved" }),
      },
      {
        name: "ai_actions.conversation_id",
        run: (tx) =>
          tx.insert(aiActions).values({ tenantId: A.tenant, type: "t", decision: "auto", conversationId: bConversation }),
      },
      {
        name: "ai_actions.message_id",
        run: (tx) => tx.insert(aiActions).values({ tenantId: A.tenant, type: "t", decision: "auto", messageId: bMessage }),
      },
      {
        name: "ai_actions UPDATE to B's conversation",
        run: (tx) =>
          tx.update(aiActions).set({ conversationId: bConversation }).where(eq(aiActions.id, A.action)),
      },
    ];

    for (const { name, run } of cases) {
      it(name, async () => {
        const err = await settle(withTenant(app.db, A.tenant, run));
        expect(pgCause(err)?.code).toBe("23503");
      });
    }

    it("same-tenant links still work and SET NULL keeps tenant_id", async () => {
      const [ac] = await dangerouslyWithoutTenant(migrator.db, (tx) =>
        tx
          .insert(aiActions)
          .values({ tenantId: B.tenant, type: "t", decision: "auto", conversationId: bConversation, messageId: bMessage })
          .returning({ id: aiActions.id }),
      );
      if (!ac) throw new Error("insert failed");
      await migrator.sql`delete from messages where id = ${bMessage}`;
      await migrator.sql`delete from conversations where id = ${bConversation}`;
      const [row] = await migrator.db
        .select({ t: aiActions.tenantId, c: aiActions.conversationId, m: aiActions.messageId })
        .from(aiActions)
        .where(eq(aiActions.id, ac.id));
      expect(row).toEqual({ t: B.tenant, c: null, m: null });
    });
  });

  describe("searchChunks / searchChunksText", () => {
    it("vector search filters by tenant, model and dims", async () => {
      const hits = await withTenant(app.db, A.tenant, (tx) =>
        searchChunks(tx, { embedding: [1, 0, 0.01], model: "test-3d", dims: 3, limit: 5 }),
      );
      expect(hits.map((h) => h.id)).toEqual([A.chunk]);
      expect(hits[0]?.sourceId).toBe(A.source);
      expect(typeof hits[0]?.score).toBe("number");
      const otherModel = await withTenant(app.db, A.tenant, (tx) =>
        searchChunks(tx, { embedding: [1, 0, 0], model: "other-model", dims: 3, limit: 5 }),
      );
      expect(otherModel).toHaveLength(0);
      const otherDims = await withTenant(app.db, A.tenant, (tx) =>
        searchChunks(tx, { embedding: [1, 0], model: "test-3d", dims: 2, limit: 5 }),
      );
      expect(otherDims).toHaveLength(0);
    });

    it("vector search honours sourceIds (B's source yields nothing for A)", async () => {
      const own = await withTenant(app.db, A.tenant, (tx) =>
        searchChunks(tx, { embedding: [1, 0, 0], model: "test-3d", dims: 3, limit: 5, sourceIds: [A.source] }),
      );
      expect(own.map((h) => h.id)).toEqual([A.chunk]);
      const foreign = await withTenant(app.db, A.tenant, (tx) =>
        searchChunks(tx, { embedding: [1, 0, 0], model: "test-3d", dims: 3, limit: 5, sourceIds: [B.source] }),
      );
      expect(foreign).toHaveLength(0);
      const none = await withTenant(app.db, A.tenant, (tx) =>
        searchChunks(tx, { embedding: [1, 0, 0], model: "test-3d", dims: 3, limit: 5, sourceIds: [] }),
      );
      expect(none).toHaveLength(0);
    });

    it("vector search validates its input", async () => {
      await expect(
        withTenant(app.db, A.tenant, (tx) => searchChunks(tx, { embedding: [1, 0], model: "test-3d", dims: 3, limit: 5 })),
      ).rejects.toThrow(RangeError);
      await expect(
        withTenant(app.db, A.tenant, (tx) =>
          searchChunks(tx, { embedding: [1, 0, Number.NaN], model: "test-3d", dims: 3, limit: 5 }),
        ),
      ).rejects.toThrow(RangeError);
      await expect(
        withTenant(app.db, A.tenant, (tx) => searchChunks(tx, { embedding: [1, 0, 0], model: "test-3d", dims: 3, limit: 0 })),
      ).rejects.toThrow(RangeError);
    });

    it("text search uses websearch syntax and stays in the tenant", async () => {
      const hits = await withTenant(app.db, A.tenant, (tx) => searchChunksText(tx, { query: '"precio tornillo"', limit: 5 }));
      expect(hits.map((h) => h.id)).toEqual([A.chunk]);
      const excluded = await withTenant(app.db, A.tenant, (tx) =>
        searchChunksText(tx, { query: "tornillo -a", limit: 5 }),
      );
      expect(excluded).toHaveLength(0);
      const bWord = await withTenant(app.db, A.tenant, (tx) => searchChunksText(tx, { query: "b", limit: 5 }));
      expect(bWord).toHaveLength(0);
      const empty = await withTenant(app.db, A.tenant, (tx) => searchChunksText(tx, { query: "  ", limit: 5 }));
      expect(empty).toHaveLength(0);
    });

    it("returns nothing without a tenant context, even for the owner role", async () => {
      const hits = await dangerouslyWithoutTenant(migrator.db, (tx) =>
        searchChunks(tx, { embedding: [1, 0, 0], model: "test-3d", dims: 3, limit: 5 }),
      );
      expect(hits).toHaveLength(0);
      const text = await dangerouslyWithoutTenant(migrator.db, (tx) => searchChunksText(tx, { query: "tornillo", limit: 5 }));
      expect(text).toHaveLength(0);
    });
  });

  it("app role is not a member of the owners of the new tables", async () => {
    const rows = await migrator.sql<{ n: number }[]>`
      select count(*)::int as n from pg_class c
      where c.relname in ('llm_connections','agent_configs','knowledge_sources','knowledge_chunks',
                          'ai_actions','action_approvals','usage_ledger')
        and c.relnamespace = 'public'::regnamespace
        and pg_has_role(${"crmwsp_app"}, c.relowner, 'MEMBER')`;
    expect(rows[0]?.n).toBe(0);
    const forced = await migrator.sql<{ n: number }[]>`
      select count(*)::int as n from pg_class c
      where c.relname in ('llm_connections','agent_configs','knowledge_sources','knowledge_chunks',
                          'ai_actions','action_approvals','usage_ledger')
        and c.relnamespace = 'public'::regnamespace and c.relrowsecurity and c.relforcerowsecurity`;
    expect(forced[0]?.n).toBe(7);
  });
});
