import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  createProductRequestSchema,
  importFromKnowledgeRequestSchema,
  listProductsQuerySchema,
  patchProductRequestSchema,
  upsertVariantsRequestSchema,
  type ImportFromKnowledgeResponse,
  type Product,
  type ProductList,
  type VariantInput,
} from "@crmwsp/contracts";
import {
  and,
  eq,
  ilike,
  isUuid,
  knowledgeChunks,
  knowledgeSources,
  ne,
  or,
  products,
  sql,
  tenants,
  inArray,
} from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PG_UNIQUE_VIOLATION, pgCode, writeAudit } from "../inbox/audit.js";
import { decodeCursor, encodeCursor } from "../inbox/cursor.js";
import { likeEscape, toNumReq } from "../sales/util.js";
import { PRODUCT_US, loadProduct, searchVariants, selectProducts } from "./products.queries.js";
import { upsertVariants } from "./variants.js";

const skuTaken = (): ConflictError => new ConflictError("SKU already in use");

@Controller("products")
@UseGuards(TenantGuard)
export class ProductsController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<ProductList> {
    const q = parseOrThrow(listProductsQuerySchema, query);
    const pattern = q.q ? `%${likeEscape(q.q)}%` : undefined;
    const where = [
      q.status ? eq(products.status, q.status) : ne(products.status, "archived"),
      pattern ? or(ilike(products.name, pattern), ilike(products.sku, pattern), ilike(products.category, pattern)) : undefined,
    ];
    if (q.cursor) {
      const cur = decodeCursor(q.cursor);
      where.push(sql`(${PRODUCT_US}, ${products.id}) < (${cur.t}::bigint, ${cur.id}::uuid)`);
    }
    const page = await db.run((tx) => selectProducts(tx, where, q.limit + 1));
    const items = page.items.slice(0, q.limit);
    const last = items[items.length - 1];
    const lastUs = page.sortUs[items.length - 1];
    return { items, nextCursor: page.items.length > q.limit && last && lastUs ? encodeCursor({ t: lastUs, id: last.id }) : null };
  }

  /** Flat per-variant rows for the quote/order editor picker. Declared before `:id`. */
  @Get("search")
  async search(@CurrentTenantDb() db: TenantDb, @Query() query: unknown) {
    const q = parseOrThrow(listProductsQuerySchema, query);
    return { items: await db.run((tx) => searchVariants(tx, q.q, q.limit)) };
  }

  @Get(":id")
  async detail(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<Product> {
    if (!isUuid(id)) throw new NotFoundError();
    const p = await db.run((tx) => loadProduct(tx, id));
    if (!p) throw new NotFoundError();
    return p;
  }

  @Post()
  @Roles("owner", "admin")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<Product> {
    const input = parseOrThrow(createProductRequestSchema, body);
    return db
      .run(async (tx) => {
        const [row] = await tx
          .insert(products)
          .values({
            tenantId: db.tenantId,
            sku: input.sku ?? null,
            kind: input.kind,
            status: input.status,
            category: input.category ?? null,
            tags: input.tags,
            name: input.name,
            description: input.description ?? null,
            unit: input.unit ?? null,
            priceMinor: BigInt(input.priceMinor),
            currency: input.currency,
            taxRateBp: input.taxRateBp,
            trackStock: input.trackStock ?? input.kind === "physical",
            isActive: input.status !== "archived",
          })
          .returning({ id: products.id });
        if (!row) throw new Error("insert returned no row");
        // Every product has at least one variant (orders reference variants).
        const variants: VariantInput[] = input.variants?.length ? input.variants : [{ options: {}, sku: input.sku ?? null }];
        await upsertVariants(tx, db.tenantId, db.userId, row.id, variants);
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "product",
          entityId: row.id,
          action: "product.created",
          diff: { name: input.name, priceMinor: input.priceMinor, currency: input.currency, variants: variants.length },
          ip: req.ip,
        });
        const p = await loadProduct(tx, row.id);
        if (!p) throw new Error("product vanished");
        return p;
      })
      .catch((err: unknown) => {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) throw skuTaken();
        throw err;
      });
  }

  @Patch(":id")
  @Roles("owner", "admin")
  async patch(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Product> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(patchProductRequestSchema, body);
    return db
      .run(async (tx) => {
        const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
        if (!before) throw new NotFoundError();
        const set: Partial<typeof products.$inferInsert> = {};
        const diff: Record<string, unknown> = {};
        const track = <K extends keyof typeof input>(k: K, apply: () => void, from: unknown) => {
          if (input[k] !== undefined) {
            apply();
            diff[k as string] = { from, to: input[k] };
          }
        };
        track("name", () => (set.name = input.name as string), before.name);
        track("sku", () => (set.sku = input.sku ?? null), before.sku);
        track("kind", () => (set.kind = input.kind as "physical"), before.kind);
        track("status", () => {
          set.status = input.status as "active";
          set.isActive = input.status !== "archived";
        }, before.status);
        track("category", () => (set.category = input.category ?? null), before.category);
        track("tags", () => (set.tags = input.tags as string[]), before.tags);
        track("description", () => (set.description = input.description ?? null), before.description);
        track("unit", () => (set.unit = input.unit ?? null), before.unit);
        track("priceMinor", () => (set.priceMinor = BigInt(input.priceMinor as number)), toNumReq(before.priceMinor));
        track("currency", () => (set.currency = input.currency as string), before.currency);
        track("taxRateBp", () => (set.taxRateBp = input.taxRateBp as number), before.taxRateBp);
        track("trackStock", () => (set.trackStock = input.trackStock as boolean), before.trackStock);
        const pricing = ["name", "priceMinor", "currency", "taxRateBp"].some((k) => k in diff);
        await tx
          .update(products)
          .set({ ...set, ...(pricing ? { version: sql`${products.version} + 1` } : {}), updatedAt: new Date() })
          .where(eq(products.id, id));
        await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "product", entityId: id, action: "product.updated", diff, ip: req.ip });
        const p = await loadProduct(tx, id);
        if (!p) throw new Error("product vanished");
        return p;
      })
      .catch((err: unknown) => {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) throw skuTaken();
        throw err;
      });
  }

  @Put(":id/variants")
  @Roles("owner", "admin")
  async putVariants(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Product> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(upsertVariantsRequestSchema, body);
    return db.run(async (tx) => {
      const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.id, id)).for("update");
      if (!p) throw new NotFoundError();
      const changes = await upsertVariants(tx, db.tenantId, db.userId, id, input.variants);
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "product",
        entityId: id,
        action: "product.variants_updated",
        diff: { variants: changes },
        ip: req.ip,
      });
      const out = await loadProduct(tx, id);
      if (!out) throw new Error("product vanished");
      return out;
    });
  }

  /**
   * Creates products (+ default variant) from catalog chunks of a knowledge source. Idempotent by SKU
   * (or by the chunk link when a chunk has no SKU): rows already present are skipped, never overwritten.
   */
  @Post("import-from-knowledge")
  @Roles("owner", "admin")
  @HttpCode(200)
  async importFromKnowledge(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<ImportFromKnowledgeResponse> {
    const { sourceId } = parseOrThrow(importFromKnowledgeRequestSchema, body);
    return db.run(async (tx) => {
      // Serializes concurrent imports of the same tenant.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${db.tenantId}:import-products`}, 0))`);
      const [source] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId));
      if (!source) throw new NotFoundError();
      const [tenant] = await tx.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, db.tenantId));
      const chunks = await tx
        .select({ id: knowledgeChunks.id, metadata: knowledgeChunks.metadata })
        .from(knowledgeChunks)
        .where(
          and(
            eq(knowledgeChunks.sourceId, sourceId),
            eq(knowledgeChunks.sourceVersion, source.version),
            sql`${knowledgeChunks.metadata}->>'kind' = 'catalog_item'`,
          ),
        )
        .orderBy(knowledgeChunks.ordinal);

      const skus = chunks.map((c) => c.metadata.sku).filter((s): s is string => typeof s === "string" && s !== "");
      const existing = await tx
        .select({ sku: products.sku, chunk: products.knowledgeChunkId })
        .from(products)
        .where(or(skus.length ? and(inArray(products.sku, skus), eq(products.isActive, true)) : undefined, inArray(products.knowledgeChunkId, chunks.map((c) => c.id))));
      const seenSkus = new Set(existing.map((e) => e.sku).filter((s): s is string => s !== null));
      const seenChunks = new Set(existing.map((e) => e.chunk).filter((s): s is string => s !== null));

      let created = 0;
      let skipped = 0;
      const productIds: string[] = [];
      for (const c of chunks) {
        const m = c.metadata;
        const sku = typeof m.sku === "string" && m.sku !== "" ? m.sku : null;
        const name = typeof m["name"] === "string" ? m["name"].trim() : "";
        const price = m.price_minor;
        if (!name || typeof price !== "number" || !Number.isSafeInteger(price) || price < 0) {
          skipped++;
          continue;
        }
        if ((sku && seenSkus.has(sku)) || seenChunks.has(c.id)) {
          skipped++;
          continue;
        }
        const currency = typeof m.currency === "string" && /^[A-Z]{3}$/.test(m.currency) ? m.currency : (tenant?.currency ?? "EUR");
        const stock = typeof m["stock"] === "number" && Number.isInteger(m["stock"]) && m["stock"] >= 0 ? m["stock"] : undefined;
        const [row] = await tx
          .insert(products)
          .values({
            tenantId: db.tenantId,
            sku,
            kind: "physical",
            status: "active",
            name,
            description: typeof m["description"] === "string" ? m["description"] : null,
            unit: typeof m["unit"] === "string" ? m["unit"] : null,
            priceMinor: BigInt(price),
            currency,
            trackStock: stock !== undefined,
            priceSource: "knowledge",
            knowledgeChunkId: c.id,
          })
          .returning({ id: products.id });
        if (!row) throw new Error("insert returned no row");
        await upsertVariants(tx, db.tenantId, db.userId, row.id, [{ options: {}, sku, ...(stock !== undefined ? { stockOnHand: stock } : {}) }], "import");
        if (sku) seenSkus.add(sku);
        seenChunks.add(c.id);
        productIds.push(row.id);
        created++;
      }
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "knowledge_source",
        entityId: sourceId,
        action: "products.imported_from_knowledge",
        diff: { created, skipped },
        ip: req.ip,
      });
      return { created, skipped, productIds };
    });
  }
}
