import { createHash, randomBytes } from "node:crypto";
import { NotFoundError, ValidationError, type Quote, type QuoteItemInput, type QuoteStatus } from "@crmwsp/contracts";
import {
  agentConfigs,
  and,
  computeLineTotal,
  contacts,
  desc,
  eq,
  inArray,
  productVariants,
  products,
  quoteItems,
  quotes,
  sql,
  type Product as ProductRow,
  type ProductVariant,
  type Quote as QuoteRow,
  type Transaction,
} from "@crmwsp/db";
import { computeLineBreakdown, sumLines, type LineBreakdown } from "@crmwsp/domain";
import { iso, toNumReq } from "./util.js";

type SQL = ReturnType<typeof sql>;

export type Role = "owner" | "admin" | "agent" | "viewer";
export const isPriceAdmin = (role: Role): boolean => role === "owner" || role === "admin";

/** Label used for catalog lines with options; `convert-to-order` matches variants by it. */
export function variantLabel(name: string, options: Record<string, string>): string {
  const vals = Object.values(options);
  return vals.length > 0 ? `${name} (${vals.join(" / ")})` : name;
}

export interface ResolvedLine {
  productId: string | null;
  /** Exact catalog variant (stored in quote_items.variant_id since 0016). */
  variantId?: string | null;
  productVersion: number | null;
  description: string;
  quantityMilli: bigint;
  unit: string;
  unitPriceMinor: bigint;
  discountBp: number;
  taxRateBp: number;
  breakdown: LineBreakdown;
  lineTotalMinor: bigint;
}

export interface PriceOverride {
  position: number;
  productId: string;
  catalogMinor: number;
  unitPriceMinor: number;
}

export function buildLine(
  base: Omit<ResolvedLine, "breakdown" | "lineTotalMinor">,
): ResolvedLine {
  const breakdown = computeLineBreakdown(base.quantityMilli, base.unitPriceMinor, base.discountBp, base.taxRateBp);
  // computeLineTotal (@crmwsp/db) is the source of truth for the stored total.
  const lineTotalMinor = computeLineTotal(base.quantityMilli, base.unitPriceMinor, base.discountBp, base.taxRateBp);
  if (lineTotalMinor !== breakdown.total) throw new Error("line total parity violated");
  return { ...base, breakdown, lineTotalMinor };
}

/**
 * Prices every line on the SERVER. Catalog lines take the variant/product price; the client's
 * `unitPriceMinor` is honored only on free lines or for owner/admin (and then it is reported for audit).
 */
export async function resolveLines(
  tx: Transaction,
  items: readonly QuoteItemInput[],
  currency: string,
  role: Role,
): Promise<{ lines: ResolvedLine[]; overrides: PriceOverride[] }> {
  const lines: ResolvedLine[] = [];
  const overrides: PriceOverride[] = [];
  for (const [position, it] of items.entries()) {
    const common = { quantityMilli: BigInt(it.quantityMilli), discountBp: it.discountBp ?? 0 };
    if (it.productId === undefined && it.variantId === undefined) {
      lines.push(
        buildLine({
          ...common,
          productId: null,
          productVersion: null,
          description: it.description as string,
          unit: "ud",
          unitPriceMinor: BigInt(it.unitPriceMinor as number),
          taxRateBp: it.taxRateBp ?? 0,
        }),
      );
      continue;
    }
    let product: ProductRow | undefined;
    let variant: ProductVariant | undefined;
    if (it.variantId !== undefined) {
      const [row] = await tx
        .select({ v: productVariants, p: products })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(productVariants.id, it.variantId));
      if (!row || (it.productId !== undefined && it.productId !== row.p.id)) throw new NotFoundError();
      product = row.p;
      variant = row.v;
    } else {
      [product] = await tx.select().from(products).where(eq(products.id, it.productId as string));
      if (!product) throw new NotFoundError();
    }
    if (product.status === "archived") throw new ValidationError("Product is archived");
    if (product.currency !== currency) throw new ValidationError("Product currency differs from the quote currency");
    const catalog = variant?.priceMinor ?? product.priceMinor;
    let price = catalog;
    if (it.unitPriceMinor !== undefined && isPriceAdmin(role) && BigInt(it.unitPriceMinor) !== catalog) {
      price = BigInt(it.unitPriceMinor);
      overrides.push({ position, productId: product.id, catalogMinor: toNumReq(catalog), unitPriceMinor: it.unitPriceMinor });
    }
    lines.push(
      buildLine({
        ...common,
        productId: product.id,
        variantId: variant?.id ?? null,
        productVersion: product.version,
        description: it.description ?? (variant ? variantLabel(product.name, variant.options) : product.name),
        unit: product.unit ?? "ud",
        unitPriceMinor: price,
        taxRateBp: product.taxRateBp,
      }),
    );
  }
  return { lines, overrides };
}

export function totalsOf(lines: readonly ResolvedLine[]) {
  return sumLines(lines.map((l) => l.breakdown));
}

export async function replaceItems(tx: Transaction, tenantId: string, quoteId: string, lines: readonly ResolvedLine[]): Promise<void> {
  await tx.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  await tx.insert(quoteItems).values(
    lines.map((l, position) => ({
      tenantId,
      quoteId,
      position,
      productId: l.productId,
      variantId: l.variantId ?? null,
      productVersion: l.productVersion,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      unitPriceMinor: l.unitPriceMinor,
      discountBp: l.discountBp,
      taxRateBp: l.taxRateBp,
      lineTotalMinor: l.lineTotalMinor,
    })),
  );
}

export async function nextNumber(tx: Transaction, kind: "quote" | "order", now = new Date()): Promise<string> {
  const rows = await tx.execute<{ n: string }>(sql`select public.next_document_number(${kind}::text, ${now.getUTCFullYear()}::int) as n`);
  const n = Array.from(rows)[0]?.n;
  if (!n) throw new Error("next_document_number returned nothing");
  return n;
}

export async function approvalThreshold(tx: Transaction): Promise<bigint | null> {
  const [c] = await tx.select({ t: agentConfigs.approvalThresholdMinor }).from(agentConfigs).where(eq(agentConfigs.isActive, true)).limit(1);
  return c?.t ?? null;
}

export function needsApproval(totalMinor: bigint, discountMinor: bigint, threshold: bigint | null): boolean {
  return discountMinor > 0n || (threshold !== null && totalMinor > threshold);
}

export async function selectQuotes(tx: Transaction, where: Array<SQL | undefined>, limit = 200): Promise<Quote[]> {
  const rows = await tx
    .select({ q: quotes, contactName: contacts.name, contactPhone: contacts.phoneE164 })
    .from(quotes)
    .innerJoin(contacts, eq(contacts.id, quotes.contactId))
    .where(and(...where))
    .orderBy(desc(quotes.createdAt), desc(quotes.id))
    .limit(limit);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.q.id);
  const items = await tx.select().from(quoteItems).where(inArray(quoteItems.quoteId, ids)).orderBy(quoteItems.position);
  const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => x !== null))];
  const stock = new Map<string, number | null>();
  if (productIds.length > 0) {
    const s = await tx
      .select({
        id: products.id,
        track: products.trackStock,
        available: sql<number>`coalesce(sum(case when ${productVariants.isActive} then ${productVariants.stockOnHand} - ${productVariants.stockReserved} else 0 end), 0)::int`,
      })
      .from(products)
      .leftJoin(productVariants, eq(productVariants.productId, products.id))
      .where(inArray(products.id, productIds))
      .groupBy(products.id);
    for (const r of s) stock.set(r.id, r.track ? r.available : null);
  }
  const threshold = await approvalThreshold(tx);
  return rows.map(({ q, contactName, contactPhone }) => ({
    id: q.id,
    number: q.number,
    status: q.status as QuoteStatus,
    currency: q.currency,
    items: items
      .filter((i) => i.quoteId === q.id)
      .map((i) => ({
        id: i.id,
        description: i.description,
        quantityMilli: toNumReq(i.quantityMilli),
        unit: i.unit ?? "ud",
        unitPriceMinor: toNumReq(i.unitPriceMinor),
        discountBp: i.discountBp,
        taxRateBp: i.taxRateBp,
        lineTotalMinor: toNumReq(i.lineTotalMinor),
        productId: i.productId,
        knowledgeChunkId: i.knowledgeChunkId,
        stock: i.productId ? (stock.get(i.productId) ?? null) : null,
      })),
    subtotalMinor: toNumReq(q.subtotalMinor),
    discountMinor: toNumReq(q.discountMinor),
    taxMinor: toNumReq(q.taxMinor),
    totalMinor: toNumReq(q.totalMinor),
    validUntil: q.validUntil.toISOString(),
    notes: q.notes,
    terms: q.terms,
    contact: { id: q.contactId, name: contactName, phoneE164: contactPhone },
    opportunityId: q.opportunityId,
    conversationId: q.conversationId,
    pdfUrl: `/quotes/${q.id}/pdf`,
    createdByType: q.createdByType,
    approvalRequired: q.status === "pending_approval" || needsApproval(q.totalMinor, q.discountMinor, threshold),
    sentAt: iso(q.sentAt),
    acceptedAt: iso(q.acceptedAt),
    createdAt: q.createdAt.toISOString(),
    lockVersion: q.lockVersion,
  }));
}

export async function loadQuote(tx: Transaction, id: string): Promise<Quote> {
  const [q] = await selectQuotes(tx, [eq(quotes.id, id)], 1);
  if (!q) throw new NotFoundError();
  return q;
}

export async function lockQuote(tx: Transaction, id: string): Promise<QuoteRow> {
  const [q] = await tx.select().from(quotes).where(eq(quotes.id, id)).for("update");
  if (!q) throw new NotFoundError();
  return q;
}

// --- Acceptance token: `<tenantId>.<32 random bytes, base64url>`; only sha256(secret) is stored. ------------

export function newAcceptToken(tenantId: string): { token: string; hash: Buffer } {
  const secret = randomBytes(32).toString("base64url");
  return { token: `${tenantId}.${secret}`, hash: createHash("sha256").update(secret).digest() };
}

const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;

export function parseAcceptToken(token: string): { tenantId: string; hash: Buffer } | null {
  const m = TOKEN_RE.exec(token);
  if (!m?.[1] || !m[2]) return null;
  return { tenantId: m[1].toLowerCase(), hash: createHash("sha256").update(m[2]).digest() };
}
