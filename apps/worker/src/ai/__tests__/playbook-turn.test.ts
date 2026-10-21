import { randomUUID } from "node:crypto";
import type { CipherBox } from "@crmwsp/crypto";
import { aiActions, salesPlaybooks, users, type DbHandle } from "@crmwsp/db";
import { Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processAiTurn, processEmbedSource, type AiDeps } from "../index.js";
import { createRedis } from "../../queue.js";
import { APP_URL, MIGRATOR_URL, REDIS_URL, createDb, dropTenants, hasEnv } from "../../__tests__/helpers.js";
import {
  capturePublisher,
  chatResponse,
  makeCipher,
  mockLlm,
  publicLookup,
  seedAiTenant,
  seedConversation,
  seedKnowledge,
  type AiTenant,
  type MockLlm,
} from "../../__tests__/ai-helpers.js";

/** Strict-mode AI turn carrying the playbook detection fields. */
const turn = (o: { text: string; chunkId: string; salesStage: unknown; objection: unknown }): string =>
  JSON.stringify({
    reply: { text: o.text, claims: [{ kind: "price", text: "precio", citations: [{ chunkId: o.chunkId }] }] },
    reaction: null,
    actions: [],
    salesStage: o.salesStage,
    objection: o.objection,
    confidence: 0.9,
    needsHuman: false,
    reason: "ok",
  });

describe.skipIf(!hasEnv)("sales playbook in the AI turn (Postgres + Redis, mocked LLM)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let cipher: CipherBox;
  let redis: Redis;
  let outbound: Queue;
  const tenants: string[] = [];
  const createdUsers: string[] = [];
  const pub = capturePublisher();

  const deps = (llm: MockLlm): AiDeps => ({
    db: app.db,
    cipher,
    publisher: pub.publisher,
    outboundQueue: outbound,
    lockRedis: redis,
    fetch: llm.fetch,
    lookup: publicLookup,
  });
  const tenant = async (): Promise<AiTenant> => {
    const t = await seedAiTenant(migrator, cipher, {});
    tenants.push(t.tenantId);
    return t;
  };
  const draftOf = async (t: AiTenant, conversationId: string) =>
    (await migrator.db.select().from(aiActions).where(and(eq(aiActions.tenantId, t.tenantId), eq(aiActions.conversationId, conversationId)))).find(
      (a) => a.type === "draft_reply",
    );

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 4 });
    cipher = makeCipher();
    redis = createRedis(REDIS_URL as string);
    outbound = new Queue(`outbound-playbook-${randomUUID()}`, { connection: createRedis(REDIS_URL as string) });
  });

  afterAll(async () => {
    await outbound?.obliterate({ force: true }).catch(() => undefined);
    await outbound?.close();
    redis?.disconnect();
    if (migrator) {
      await dropTenants(migrator, tenants);
      for (const id of createdUsers) await migrator.db.delete(users).where(eq(users.id, id));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("without a playbook the prompt has no block and nothing is stored", async () => {
    const t = await tenant();
    const { sourceId, chunkIds } = await seedKnowledge(migrator, t, ["El corte cuesta 25 EUR."]);
    const conv = await seedConversation(migrator, t, "assist", "es muy caro el corte");
    const llm = mockLlm((call) => {
      expect(JSON.stringify(call.body.messages)).not.toContain("sales_playbook");
      return chatResponse(turn({ text: "Cuesta 25 EUR.", chunkId: chunkIds[0]!, salesStage: "closing", objection: "es-caro" }));
    });
    await processEmbedSource(deps(llm), { tenantId: t.tenantId, sourceId });
    await processAiTurn(deps(llm), { tenantId: t.tenantId, conversationId: conv.conversationId, triggerMessageId: conv.firstMessageId! });
    const draft = await draftOf(t, conv.conversationId);
    expect(draft?.payload).toEqual({ text: "Cuesta 25 EUR.", claims: expect.any(Array) });
  });

  it("an enabled playbook injects only the matching objection and stores the detected stage", async () => {
    const t = await tenant();
    await migrator.db.insert(salesPlaybooks).values({ tenantId: t.tenantId, enabled: true, config: {} });
    const { sourceId, chunkIds } = await seedKnowledge(migrator, t, ["El corte cuesta 25 EUR."]);
    const conv = await seedConversation(migrator, t, "assist", "me parece muy caro el corte");
    const llm = mockLlm((call) => {
      const system = call.body.messages?.[0]?.content ?? "";
      expect(system).toContain("<sales_playbook>");
      expect(system).toContain("id=es-caro");
      expect(system).not.toContain("id=no-confio");
      expect(system).toContain("Likely current stage: discovery");
      return chatResponse(turn({ text: "Cuesta 25 EUR.", chunkId: chunkIds[0]!, salesStage: "objections", objection: "es-caro" }));
    });
    await processEmbedSource(deps(llm), { tenantId: t.tenantId, sourceId });
    await processAiTurn(deps(llm), { tenantId: t.tenantId, conversationId: conv.conversationId, triggerMessageId: conv.firstMessageId! });
    const draft = await draftOf(t, conv.conversationId);
    expect(draft?.payload).toMatchObject({ text: "Cuesta 25 EUR.", salesStage: "objections", objection: "es-caro" });
  });

  it("drops an objection id that was not offered and an off-list stage never fails the turn", async () => {
    const t = await tenant();
    await migrator.db.insert(salesPlaybooks).values({ tenantId: t.tenantId, enabled: true, config: {} });
    const { sourceId, chunkIds } = await seedKnowledge(migrator, t, ["El corte cuesta 25 EUR."]);
    const conv = await seedConversation(migrator, t, "assist", "hola, buenas tardes");
    const llm = mockLlm(() => chatResponse(turn({ text: "Cuesta 25 EUR.", chunkId: chunkIds[0]!, salesStage: "closing", objection: "no-confio" })));
    await processEmbedSource(deps(llm), { tenantId: t.tenantId, sourceId });
    await processAiTurn(deps(llm), { tenantId: t.tenantId, conversationId: conv.conversationId, triggerMessageId: conv.firstMessageId! });
    const draft = await draftOf(t, conv.conversationId);
    expect(draft?.payload).toMatchObject({ salesStage: "closing" });
    expect(draft?.payload).not.toHaveProperty("objection");
  });
});
