import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  discardOrderExtractionSchema,
  listOrderExtractionsQuerySchema,
  updateOrderExtractionLineSchema,
  type OrderExtractionDto,
  type OrderExtractionLine,
  type OrderExtractionList,
  type QuoteItemInput,
} from "@crmwsp/contracts";
import {
  and,
  desc,
  eq,
  isUuid,
  ne,
  or,
  orderExtractions,
  productVariants,
  products,
  quoteItems,
  quotes,
  sql,
  type OrderExtraction,
  type StoredOrderLine,
  type Transaction,
} from "@crmwsp/db";
import { resolveQuantity, type CatalogCandidate } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { nextNumber, replaceItems, resolveLines, totalsOf, variantLabel } from "../sales/quote.service.js";
import { writeAudit } from "./audit.js";

const QUOTE_VALID_DAYS = 15;

type QuoteRef = { id: string; number: string; status: string; totalMinor: bigint } | null;

const DUDOSO_REASONS = new Set(["no_match", "ambiguous", "low_confidence", "no_quantity", "unit_mismatch", "currency_mismatch"]);

export function lineToDto(l: StoredOrderLine, index: number): OrderExtractionLine {
  return {
    index,
    rawText: l.rawText,
    quantity: l.quantity,
    unit: l.unit,
    productGuess: l.productGuess,
    status: l.status,
    reason: l.reason !== null && DUDOSO_REASONS.has(l.reason) ? (l.reason as OrderExtractionLine["reason"]) : null,
    confidence: Math.max(0, Math.min(1, l.confidence)),
    editedByUser: Boolean(l.editedBy),
    match: l.match
      ? {
          productId: l.match.productId,
          variantId: l.match.variantId,
          label: l.match.label,
          unit: l.match.unit,
          unitPriceMinor: Number(l.match.unitPriceMinor),
          currency: l.match.currency,
        }
      : null,
    quantityMilli: l.quantityMilli === null ? null : Number(l.quantityMilli),
    alternatives: l.alternatives.filter((a) => isUuid(a.productId)),
  };
}

export function toDto(r: OrderExtraction, q: QuoteRef): OrderExtractionDto {
  return {
    id: r.id,
    conversationId: r.conversationId,
    messageId: r.messageId,
    source: r.source,
    status: r.status,
    reason: r.reason,
    notes: r.notes,
    currency: r.currency,
    lines: r.items.map(lineToDto),
    quote: q ? { id: q.id, number: q.number, status: q.status, totalMinor: Number(q.totalMinor) } : null,
    lockVersion: r.lockVersion,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function select(tx: Transaction, where: ReturnType<typeof and>, limit: number): Promise<OrderExtractionDto[]> {
  const rows = await tx
    .select({ r: orderExtractions, q: { id: quotes.id, number: quotes.number, status: quotes.status, totalMinor: quotes.totalMinor } })
    .from(orderExtractions)
    .leftJoin(quotes, eq(quotes.id, orderExtractions.quoteId))
    .where(where)
    .orderBy(desc(orderExtractions.createdAt), desc(orderExtractions.id))
    .limit(limit);
  return rows.map(({ r, q }) => toDto(r, q?.id ? (q as NonNullable<QuoteRef>) : null));
}

async function loadOne(tx: Transaction, id: string): Promise<OrderExtractionDto> {
  const [r] = await select(tx, and(eq(orderExtractions.id, id)), 1);
  if (!r) throw new NotFoundError();
  return r;
}

async function lockEditable(tx: Transaction, id: string, lockVersion: number): Promise<OrderExtraction> {
  const [r] = await tx.select().from(orderExtractions).where(eq(orderExtractions.id, id)).for("update");
  if (!r) throw new NotFoundError();
  if (r.lockVersion !== lockVersion) throw new ConflictError("Order extraction was modified; reload and retry");
  if (r.status !== "needs_confirmation" && r.status !== "ready") throw new ConflictError(`Order extraction is ${r.status}`);
  if (r.quoteId) {
    const [q] = await tx.select({ status: quotes.status }).from(quotes).where(eq(quotes.id, r.quoteId)).for("update");
    if (q && q.status !== "draft") throw new ConflictError(`Quote is already ${q.status}`);
  }
  return r;
}

/** Catalog candidate for a product/variant the agent picked (RLS-scoped; prices from the catalog). */
async function candidateFor(tx: Transaction, productId: string, variantId: string | null | undefined): Promise<CatalogCandidate> {
  const [p] = await tx.select().from(products).where(eq(products.id, productId));
  if (!p || !p.isActive || p.status === "archived") throw new NotFoundError();
  let label = p.name;
  let price = p.priceMinor;
  let vId: string | null = null;
  if (variantId) {
    const [v] = await tx.select().from(productVariants).where(and(eq(productVariants.id, variantId), eq(productVariants.productId, p.id)));
    if (!v || !v.isActive) throw new NotFoundError();
    label = variantLabel(p.name, v.options);
    price = v.priceMinor ?? p.priceMinor;
    vId = v.id;
  }
  return { productId: p.id, variantId: vId, productVersion: p.version, label, searchText: "", sku: p.sku, unit: p.unit, priceMinor: price, currency: p.currency, taxRateBp: p.taxRateBp };
}

/**
 * Inbox "Pedido detectado" card (F4). Agents fix matches of an order the AI detected in a voice
 * note, photo or PDF; every change re-prices the DRAFT quote on the server from the catalog. Sending
 * the quote still goes through POST /quotes/:id/submit (approval thresholds apply there).
 */
@Controller("order-extractions")
@UseGuards(TenantGuard)
export class OrderExtractionsController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<OrderExtractionList> {
    const q = parseOrThrow(listOrderExtractionsQuerySchema, query);
    // Media that turned out not to be an order is kept for idempotency but never shown.
    const visible = or(ne(orderExtractions.status, "skipped"), sql`${orderExtractions.reason} IS DISTINCT FROM 'not_an_order'`);
    const where = and(
      visible,
      q.conversationId ? eq(orderExtractions.conversationId, q.conversationId) : undefined,
      q.status ? eq(orderExtractions.status, q.status) : undefined,
    );
    return { items: await db.run((tx) => select(tx, where, q.limit)) };
  }

  @Get(":id")
  async detail(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<OrderExtractionDto> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run((tx) => loadOne(tx, id));
  }

  @Patch(":id/lines/:index")
  @Roles("owner", "admin", "agent")
  async updateLine(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Param("index") indexParam: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<OrderExtractionDto> {
    if (!isUuid(id)) throw new NotFoundError();
    const index = Number(indexParam);
    const input = parseOrThrow(updateOrderExtractionLineSchema, body);
    return db.run(async (tx) => {
      const r = await lockEditable(tx, id, input.lockVersion);
      if (!Number.isInteger(index) || index < 0 || index >= r.items.length) throw new NotFoundError();
      const items = [...r.items];
      const before = items[index]!;
      if (input.remove) {
        items.splice(index, 1);
      } else {
        const productId = input.productId ?? before.match?.productId;
        if (!productId) throw new ValidationError("Pick a catalog product for this line");
        const cand = await candidateFor(tx, productId, input.productId ? input.variantId : (input.variantId ?? before.match?.variantId));
        const lineIn =
          input.quantity !== undefined
            ? { rawText: before.rawText, productGuess: before.productGuess, quantity: input.quantity, unit: null }
            : { rawText: before.rawText, productGuess: before.productGuess, quantity: before.quantity, unit: before.unit };
        const m = resolveQuantity(lineIn, cand, 1, before.alternatives, r.currency ?? undefined);
        items[index] = {
          ...before,
          status: m.status,
          reason: m.reason,
          confidence: 1,
          editedBy: db.userId,
          match: m.match ? { ...m.match, unitPriceMinor: m.match.unitPriceMinor.toString() } : null,
          quantityMilli: m.quantityMilli === null ? null : m.quantityMilli.toString(),
        };
      }
      const currency = r.currency ?? items.find((i) => i.status === "matched" && i.match)?.match?.currency ?? null;
      const quoteId = await this.syncQuote(tx, db, r, items, currency);
      const status = items.some((i) => i.status === "dudoso") ? "needs_confirmation" : "ready";
      await tx
        .update(orderExtractions)
        .set({ items, status, currency, quoteId, lockVersion: sql`${orderExtractions.lockVersion} + 1`, updatedAt: new Date() })
        .where(eq(orderExtractions.id, id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "order_extraction",
        entityId: id,
        action: input.remove ? "order_extraction.line_removed" : "order_extraction.line_updated",
        diff: {
          index,
          before: { productId: before.match?.productId ?? null, variantId: before.match?.variantId ?? null, quantityMilli: before.quantityMilli },
          after: input.remove ? null : { productId: items[index]!.match?.productId ?? null, variantId: items[index]!.match?.variantId ?? null, quantityMilli: items[index]!.quantityMilli },
          quoteId,
        },
        ip: req.ip,
      });
      return loadOne(tx, id);
    });
  }

  @Post(":id/discard")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  async discard(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<OrderExtractionDto> {
    if (!isUuid(id)) throw new NotFoundError();
    const { lockVersion } = parseOrThrow(discardOrderExtractionSchema, body ?? {});
    return db.run(async (tx) => {
      const r = await lockEditable(tx, id, lockVersion);
      if (r.quoteId) {
        await tx
          .update(quotes)
          .set({ status: "cancelled", lockVersion: sql`${quotes.lockVersion} + 1`, updatedAt: new Date() })
          .where(and(eq(quotes.id, r.quoteId), eq(quotes.status, "draft")));
      }
      await tx
        .update(orderExtractions)
        .set({ status: "discarded", lockVersion: sql`${orderExtractions.lockVersion} + 1`, updatedAt: new Date() })
        .where(eq(orderExtractions.id, id));
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "order_extraction", entityId: id, action: "order_extraction.discarded", diff: { quoteId: r.quoteId }, ip: req.ip });
      return loadOne(tx, id);
    });
  }

  /** Re-prices the draft quote from the catalog (server side); creates it when the first line matches. */
  private async syncQuote(tx: Transaction, db: TenantDb, r: OrderExtraction, items: StoredOrderLine[], currency: string | null): Promise<string | null> {
    const inputs: QuoteItemInput[] = items
      .filter((i) => i.status === "matched" && i.match && i.quantityMilli !== null && i.match.currency === currency)
      .map((i) => ({
        productId: i.match!.productId,
        ...(i.match!.variantId ? { variantId: i.match!.variantId } : {}),
        quantityMilli: Number(i.quantityMilli),
      }));
    if (!currency || inputs.length === 0) {
      if (r.quoteId) await tx.delete(quoteItems).where(eq(quoteItems.quoteId, r.quoteId));
      if (r.quoteId) await tx.update(quotes).set({ subtotalMinor: 0n, discountMinor: 0n, taxMinor: 0n, totalMinor: 0n, updatedAt: new Date() }).where(eq(quotes.id, r.quoteId));
      return r.quoteId;
    }
    const { lines } = await resolveLines(tx, inputs, currency, "agent");
    const totals = totalsOf(lines);
    let quoteId = r.quoteId;
    if (!quoteId) {
      const [conv] = await tx.execute<{ contact_id: string }>(sql`select contact_id from conversations where id = ${r.conversationId}`);
      if (!conv) throw new NotFoundError();
      const now = new Date();
      const [q] = await tx
        .insert(quotes)
        .values({
          tenantId: db.tenantId,
          number: await nextNumber(tx, "quote", now),
          contactId: conv.contact_id,
          conversationId: r.conversationId,
          status: "draft",
          currency,
          validUntil: new Date(now.getTime() + QUOTE_VALID_DAYS * 24 * 3600 * 1000),
          notes: "Borrador generado a partir de un pedido detectado por la IA. Revisar antes de enviar.",
          createdByType: "user",
        })
        .returning({ id: quotes.id });
      if (!q) throw new Error("quote insert returned no row");
      quoteId = q.id;
    }
    await replaceItems(tx, db.tenantId, quoteId, lines);
    await tx
      .update(quotes)
      .set({
        subtotalMinor: totals.subtotal,
        discountMinor: totals.discount,
        taxMinor: totals.tax,
        totalMinor: totals.total,
        lockVersion: sql`${quotes.lockVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId));
    return quoteId;
  }
}
