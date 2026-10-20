import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  NotFoundError,
  ValidationError,
  createTextKnowledgeSourceRequestSchema,
  type KnowledgeConflict,
  type KnowledgeSource,
} from "@crmwsp/contracts";
import {
  and,
  desc,
  eq,
  isUuid,
  knowledgeChunks,
  knowledgeSources,
  ne,
  sql,
  tenants,
  type KnowledgeSource as KnowledgeSourceRow,
  type Transaction,
} from "@crmwsp/db";
import { detectConflicts, type SourcedCatalogRow } from "@crmwsp/knowledge";
import type { Queue } from "bullmq";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { AI_JOB_OPTIONS, AI_QUEUE, EMBED_SOURCE_JOB, type EmbedSourceJobData } from "../ai/ai.constants.js";
import type { HttpReply, HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { processSource, type ProcessedSource, type RawSource } from "./source-processing.js";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** MIME types browsers send for each upload kind (Windows reports CSV as application/vnd.ms-excel). */
const ALLOWED_MIME: Record<"csv" | "pdf", readonly string[]> = {
  csv: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
  pdf: ["application/pdf"],
};

interface MultipartPart {
  type: "file" | "field";
  fieldname: string;
  filename?: string;
  mimetype?: string;
  value?: unknown;
  toBuffer(): Promise<Buffer>;
}
interface MultipartRequest extends HttpRequest {
  isMultipart?: () => boolean;
  parts(): AsyncIterableIterator<MultipartPart>;
}

interface UploadedFile {
  kind: "csv" | "pdf";
  title: string;
  data: Buffer;
}

const invalid = (path: string, message: string): ValidationError =>
  new ValidationError("Validation failed", { details: [{ path, message }] });

function safeTitle(filename: string | undefined): string {
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return clean || "Untitled";
}

/** Reads the multipart body: one `file` (<= 15 MB, allowed MIME) plus the `kind` field (csv | pdf). */
async function readUpload(req: MultipartRequest): Promise<UploadedFile> {
  let kind: string | undefined;
  let file: { filename: string | undefined; mimetype: string; data: Buffer } | undefined;
  for await (const part of req.parts()) {
    if (part.type === "field") {
      if (part.fieldname === "kind" && typeof part.value === "string") kind = part.value;
      continue;
    }
    if (part.fieldname !== "file" || file) {
      await part.toBuffer().catch(() => undefined); // drain
      throw invalid("file", "Send exactly one file in the 'file' field");
    }
    // Throws a 413 (mapped to 400) when the file exceeds the plugin's fileSize limit.
    file = { filename: part.filename, mimetype: (part.mimetype ?? "").toLowerCase(), data: await part.toBuffer() };
  }
  if (kind !== "csv" && kind !== "pdf") throw invalid("kind", "kind must be 'csv' or 'pdf'");
  if (!file) throw invalid("file", "A file is required");
  if (file.data.length === 0) throw invalid("file", "The file is empty");
  if (!ALLOWED_MIME[kind].includes(file.mimetype.split(";")[0]?.trim() ?? "")) {
    throw invalid("file", `Unsupported file type for ${kind}`);
  }
  return { kind, title: safeTitle(file.filename), data: file.data };
}

function toDto(row: KnowledgeSourceRow, chunkCount: number): KnowledgeSource {
  return {
    id: row.id,
    kind: row.kind === "url" ? "text" : row.kind,
    title: row.title,
    status: row.status === "failed" ? "error" : row.status,
    version: row.version,
    chunkCount,
    updatedAt: row.updatedAt.toISOString(),
    ...(row.error ? { error: row.error } : {}),
  };
}

async function chunkCountOf(tx: Transaction, sourceId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.sourceId, sourceId));
  return r?.n ?? 0;
}

@Controller("knowledge")
@UseGuards(TenantGuard)
export class KnowledgeController {
  constructor(@Inject(AI_QUEUE) private readonly queue: Queue) {}

  @Get("sources")
  @Roles("owner", "admin", "agent")
  async list(@CurrentTenantDb() db: TenantDb): Promise<{ items: KnowledgeSource[] }> {
    const rows = await db.run((tx) =>
      tx
        .select({ source: knowledgeSources, n: sql<number>`count(${knowledgeChunks.id})::int` })
        .from(knowledgeSources)
        .leftJoin(knowledgeChunks, eq(knowledgeChunks.sourceId, knowledgeSources.id))
        .where(and(eq(knowledgeSources.isActive, true), ne(knowledgeSources.kind, "url")))
        .groupBy(knowledgeSources.id)
        .orderBy(desc(knowledgeSources.createdAt), desc(knowledgeSources.id)),
    );
    return { items: rows.map((r) => toDto(r.source, r.n)) };
  }

  /**
   * Multipart (`file` + `kind` csv|pdf) or JSON (`{kind: faq|text, title, content}`). Parsed in the
   * request; source + chunks are written in one transaction; embeddings are produced later by the
   * worker (`embed-source`). The same content hash already active returns the existing source.
   */
  @Post("sources")
  @Roles("owner", "admin")
  async create(
    @CurrentTenantDb() db: TenantDb,
    @Req() req: MultipartRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: HttpReply,
  ): Promise<KnowledgeSource> {
    let title: string;
    let raw: (defaultCurrency: string) => RawSource;
    if (req.isMultipart?.()) {
      const up = await readUpload(req);
      title = up.title;
      raw = (defaultCurrency) => (up.kind === "csv" ? { kind: "csv", data: up.data, defaultCurrency } : { kind: "pdf", data: up.data });
    } else {
      const input = parseOrThrow(createTextKnowledgeSourceRequestSchema, body);
      title = input.title;
      raw = () => ({ kind: input.kind, content: input.content });
    }

    const [tenant] = await db.run((tx) => tx.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, db.tenantId)));
    const processed: ProcessedSource = await processSource(raw(tenant?.currency ?? "EUR"));

    const { source, chunkCount, created } = await db.run(async (tx) => {
      // Serialize concurrent identical uploads (no unique index on the hash).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${db.tenantId}:${processed.hash}`}, 0))`);
      const [existing] = await tx
        .select()
        .from(knowledgeSources)
        .where(
          and(
            eq(knowledgeSources.contentHash, processed.hash),
            eq(knowledgeSources.kind, processed.kind),
            eq(knowledgeSources.isActive, true),
          ),
        )
        .limit(1);
      if (existing) return { source: existing, chunkCount: await chunkCountOf(tx, existing.id), created: false };

      const [row] = await tx
        .insert(knowledgeSources)
        .values({ tenantId: db.tenantId, kind: processed.kind, title, status: "ready", contentHash: processed.hash, version: 1 })
        .returning();
      if (!row) throw new Error("insert returned no row");
      for (let i = 0; i < processed.chunks.length; i += 500) {
        await tx.insert(knowledgeChunks).values(
          processed.chunks.slice(i, i + 500).map((c) => ({
            tenantId: db.tenantId,
            sourceId: row.id,
            sourceVersion: row.version,
            ordinal: c.ordinal,
            content: c.content,
            metadata: c.metadata,
          })),
        );
      }
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "knowledge_source",
        entityId: row.id,
        action: "knowledge_source.created",
        diff: { kind: processed.kind, title, chunks: processed.chunks.length, contentHash: processed.hash },
        ip: req.ip,
      });
      return { source: row, chunkCount: processed.chunks.length, created: true };
    });

    // After commit. Also on idempotent hits (recovers a lost enqueue); the jobId dedupes in BullMQ.
    const data: EmbedSourceJobData = { tenantId: db.tenantId, sourceId: source.id };
    await this.queue.add(EMBED_SOURCE_JOB, data, { ...AI_JOB_OPTIONS, jobId: `embed-${source.id}` });
    reply.status(created ? 201 : 200);
    return toDto(source, chunkCount);
  }

  @Delete("sources/:id")
  @Roles("owner", "admin")
  @HttpCode(204)
  async remove(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    await db.run(async (tx) => {
      // Chunks go with the source (FK cascade): the AI must not cite deleted content.
      const [deleted] = await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, id)).returning({ id: knowledgeSources.id, title: knowledgeSources.title, kind: knowledgeSources.kind });
      if (!deleted) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "knowledge_source",
        entityId: id,
        action: "knowledge_source.deleted",
        diff: { kind: deleted.kind, title: deleted.title },
        ip: req.ip,
      });
    });
  }

  /** Same SKU/name with different prices across active, ready catalog sources. */
  @Get("conflicts")
  @Roles("owner", "admin", "agent")
  async conflicts(@CurrentTenantDb() db: TenantDb): Promise<{ items: KnowledgeConflict[] }> {
    const chunks = await db.run((tx) =>
      tx
        .select({
          sourceId: knowledgeChunks.sourceId,
          title: knowledgeSources.title,
          ordinal: knowledgeChunks.ordinal,
          metadata: knowledgeChunks.metadata,
        })
        .from(knowledgeChunks)
        .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeChunks.sourceId))
        .where(
          and(
            eq(knowledgeSources.isActive, true),
            eq(knowledgeSources.status, "ready"),
            sql`${knowledgeChunks.metadata}->>'kind' = 'catalog_item'`,
          ),
        ),
    );
    const titles = new Map<string, string>();
    const rows: SourcedCatalogRow[] = [];
    for (const c of chunks) {
      const m = c.metadata;
      if (typeof m["name"] !== "string" || typeof m.price_minor !== "number" || typeof m.currency !== "string") continue;
      titles.set(c.sourceId, c.title);
      rows.push({
        source: c.sourceId,
        line: c.ordinal + 1,
        name: m["name"],
        price_minor: m.price_minor,
        currency: m.currency,
        ...(typeof m.sku === "string" ? { sku: m.sku } : {}),
      });
    }
    return {
      items: detectConflicts(rows).map((c) => ({
        key: c.key,
        sources: c.entries.map((e) => ({
          sourceId: e.source,
          title: titles.get(e.source) ?? "",
          priceMinor: e.price_minor,
          currency: e.currency,
        })),
      })),
    };
  }
}
