import { estimateCost } from "@crmwsp/ai";
import { knowledgeChunks, knowledgeSources, llmConnections, usageLedger, withTenant } from "@crmwsp/db";
import { UnrecoverableError } from "bullmq";
import { and, asc, eq, sql } from "drizzle-orm";
import { assertIds, buildProvider, embeddingModelFor, type AiDeps } from "./common.js";

export const EMBED_BATCH_SIZE = 64;
/** Safety valve against a provider that never makes progress. */
const MAX_BATCHES = 2_000;

export type EmbedSourceResult =
  | { outcome: "embedded"; chunks: number; model: string }
  | { outcome: "skipped"; reason: "no-embeddings" };

/**
 * Embeds the chunks of one knowledge source that have no embedding for the connection's model.
 * Idempotent: chunks already embedded with the same model are never sent again. Each batch is its
 * own transaction (progress survives a later failure) serialised per source by an advisory lock.
 * Without an active connection or the `embeddings` capability it ends quietly (search uses full text).
 */
export async function processEmbedSource(deps: AiDeps, data: unknown): Promise<EmbedSourceResult> {
  const { tenantId, sourceId } = assertIds(data, ["tenantId", "sourceId"]);

  const setup = await withTenant(deps.db, tenantId, async (tx) => {
    const [conn] = await tx.select().from(llmConnections).where(eq(llmConnections.isActive, true)).limit(1);
    if (!conn || conn.capabilities.embeddings !== true || !conn.apiKeyEncrypted) return null;
    const [source] = await tx
      .select({ version: knowledgeSources.version })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, sourceId))
      .limit(1);
    if (!source) throw new UnrecoverableError("knowledge source not found");
    return { conn, version: source.version };
  });
  if (!setup) return { outcome: "skipped", reason: "no-embeddings" };

  const model = embeddingModelFor(deps, setup.conn);
  const provider = buildProvider(deps, tenantId, setup.conn);
  const needsEmbedding = sql`(${knowledgeChunks.embedding} is null or ${knowledgeChunks.embeddingModel} is distinct from ${model})`;

  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const done = await withTenant(deps.db, tenantId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`embed:${tenantId}:${sourceId}`}, 0))`);
      const pending = await tx
        .select({ id: knowledgeChunks.id, content: knowledgeChunks.content })
        .from(knowledgeChunks)
        .where(and(eq(knowledgeChunks.sourceId, sourceId), eq(knowledgeChunks.sourceVersion, setup.version), needsEmbedding))
        .orderBy(asc(knowledgeChunks.ordinal), asc(knowledgeChunks.id))
        .limit(EMBED_BATCH_SIZE);
      if (pending.length === 0) return 0;

      const res = await provider.embed({ model, input: pending.map((c) => c.content.trim() || "-") });
      for (const [idx, chunk] of pending.entries()) {
        const vector = res.vectors[idx];
        if (!vector) throw new Error("embedding batch is shorter than its input");
        await tx
          .update(knowledgeChunks)
          .set({
            embedding: sql`${`[${vector.join(",")}]`}::vector`,
            embeddingModel: model,
            embeddingDims: res.dims,
          })
          .where(eq(knowledgeChunks.id, chunk.id));
      }
      const cost = estimateCost(model, { inputTokens: res.usage.inputTokens });
      await tx.insert(usageLedger).values({
        tenantId,
        kind: "embedding_tokens",
        quantity: String(res.usage.inputTokens),
        unit: "tokens",
        costMinor: BigInt(cost.costMinor),
        currency: cost.currency,
        refType: "knowledge_source",
        refId: sourceId,
        meta: { model, chunks: pending.length, dims: res.dims, verified: cost.verified, priceKnown: cost.known, unit: "usd_microcents" },
      });
      return pending.length;
    });
    if (done === 0) break;
    total += done;
  }
  return { outcome: "embedded", chunks: total, model };
}
