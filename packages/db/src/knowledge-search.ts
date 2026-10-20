import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { knowledgeChunks, type KnowledgeChunkMetadata } from "./schema/knowledge.js";

const MAX_LIMIT = 100;

export interface ChunkHit {
  id: string;
  sourceId: string;
  sourceVersion: number;
  ordinal: number;
  content: string;
  metadata: KnowledgeChunkMetadata;
  /** Cosine distance (vector search) or ts_rank (text search, higher = better). */
  score: number;
}

export interface SearchChunksParams {
  embedding: number[];
  /** Embedding model that produced `embedding`; only rows of the same model match. */
  model: string;
  /** Must equal `embedding.length`; only rows with the same dimension match. */
  dims: number;
  limit: number;
  sourceIds?: string[];
}

export interface SearchChunksTextParams {
  query: string;
  limit: number;
}

function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be an integer in [1, ${MAX_LIMIT}]`);
  }
}

// Explicit tenant filter on top of RLS: without a tenant context (e.g. a tx
// opened outside withTenant) the search returns nothing, even for the owner.
const currentTenant = (): SQL =>
  sql`${knowledgeChunks.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`;

const hitColumns = {
  id: knowledgeChunks.id,
  sourceId: knowledgeChunks.sourceId,
  sourceVersion: knowledgeChunks.sourceVersion,
  ordinal: knowledgeChunks.ordinal,
  content: knowledgeChunks.content,
  metadata: knowledgeChunks.metadata,
};

/**
 * Nearest chunks by cosine distance. `tx` must come from `withTenant`.
 * Filters by `embedding_model` and `embedding_dims` because the column has no
 * fixed dimension (ADR 0002, pgvector notes): vectors of other models are
 * never compared.
 */
export async function searchChunks(tx: Transaction, params: SearchChunksParams): Promise<ChunkHit[]> {
  const { embedding, model, dims, limit, sourceIds } = params;
  checkLimit(limit);
  if (!Number.isInteger(dims) || dims < 1 || embedding.length !== dims) {
    throw new RangeError("embedding length must equal dims");
  }
  if (!embedding.every((v) => Number.isFinite(v))) {
    throw new RangeError("embedding must contain finite numbers");
  }
  if (model.length === 0) throw new RangeError("model is required");
  if (sourceIds !== undefined && sourceIds.length === 0) return [];

  const literal = `[${embedding.join(",")}]`;
  const distance = sql<number>`(${knowledgeChunks.embedding} <=> ${literal}::vector)`;
  const rows = await tx
    .select({ ...hitColumns, score: distance.mapWith(Number) })
    .from(knowledgeChunks)
    .where(
      and(
        currentTenant(),
        isNotNull(knowledgeChunks.embedding),
        eq(knowledgeChunks.embeddingModel, model),
        eq(knowledgeChunks.embeddingDims, dims),
        sourceIds ? inArray(knowledgeChunks.sourceId, sourceIds) : undefined,
      ),
    )
    .orderBy(distance, knowledgeChunks.id)
    .limit(limit);
  return rows;
}

/**
 * Full-text search (`websearch_to_tsquery('simple', query)`), for hybrid search
 * or tenants without embeddings. `tx` must come from `withTenant`.
 */
export async function searchChunksText(tx: Transaction, params: SearchChunksTextParams): Promise<ChunkHit[]> {
  const { query, limit } = params;
  checkLimit(limit);
  if (query.trim().length === 0) return [];
  const tsv = sql`to_tsvector('simple', ${knowledgeChunks.content})`;
  const tsq = sql`websearch_to_tsquery('simple', ${query})`;
  const rank = sql<number>`ts_rank(${tsv}, ${tsq})`;
  const rows = await tx
    .select({ ...hitColumns, score: rank.mapWith(Number) })
    .from(knowledgeChunks)
    .where(and(currentTenant(), sql`${tsv} @@ ${tsq}`))
    .orderBy(sql`${rank} desc`, knowledgeChunks.id)
    .limit(limit);
  return rows;
}
