import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * pgvector column WITHOUT a fixed dimension: BYOK providers use different
 * embedding sizes, so each row records `embedding_model` and `embedding_dims`.
 * Consequence: no HNSW/IVFFlat index (they need a fixed dimension); searches
 * filter by tenant (RLS + btree) and compute distance over the tenant's rows.
 */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) => (JSON.parse(value) as number[]),
});

export const knowledgeSourceKind = pgEnum("knowledge_source_kind", ["csv", "pdf", "faq", "text", "url"]);
export const knowledgeSourceStatus = pgEnum("knowledge_source_status", ["pending", "processing", "ready", "failed"]);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: knowledgeSourceKind("kind").notNull(),
    title: text("title").notNull(),
    storageKey: text("storage_key"),
    version: integer("version").notNull().default(1),
    status: knowledgeSourceStatus("status").notNull().default("pending"),
    contentHash: text("content_hash"),
    error: text("error"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // UNIQUE (tenant_id, id): target of the composite FK from knowledge_chunks.
  (t) => [uniqueIndex("knowledge_sources_tenant_id_id_idx").on(t.tenantId, t.id)],
);

export interface KnowledgeChunkMetadata {
  sku?: string;
  price_minor?: number;
  currency?: string;
  [key: string]: unknown;
}

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Composite FK (tenant_id, source_id) below: same-tenant source only.
    sourceId: uuid("source_id").notNull(),
    sourceVersion: integer("source_version").notNull(),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<KnowledgeChunkMetadata>().notNull().default({}),
    embedding: vector("embedding"),
    embeddingModel: text("embedding_model"),
    embeddingDims: integer("embedding_dims"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("knowledge_chunks_tenant_id_id_idx").on(t.tenantId, t.id),
    index("knowledge_chunks_tenant_source_idx").on(t.tenantId, t.sourceId),
    foreignKey({
      name: "knowledge_chunks_tenant_source_fk",
      columns: [t.tenantId, t.sourceId],
      foreignColumns: [knowledgeSources.tenantId, knowledgeSources.id],
    }).onDelete("cascade"),
    index("knowledge_chunks_content_fts_idx").using("gin", sql`to_tsvector('simple', ${t.content})`),
  ],
);

export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type NewKnowledgeSource = typeof knowledgeSources.$inferInsert;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type NewKnowledgeChunk = typeof knowledgeChunks.$inferInsert;
export type KnowledgeSourceKind = (typeof knowledgeSourceKind.enumValues)[number];
export type KnowledgeSourceStatus = (typeof knowledgeSourceStatus.enumValues)[number];
