import type { Media, Product, ProductSearchItem, Variant } from "@crmwsp/contracts";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  productMedia,
  productVariants,
  products,
  sql,
  type Transaction,
  type Product as ProductRow,
  type ProductVariant,
  type ProductMedia,
} from "@crmwsp/db";
import { toNum, toNumReq } from "../sales/util.js";

type SQL = ReturnType<typeof sql>;

export const PRODUCT_US = sql`(extract(epoch from ${products.createdAt}) * 1000000)::bigint`;

/** Normalized variant key: lower-cased `key=value` pairs sorted by key; '' for the default variant. */
export function optionKeyOf(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([k, v]) => [k.trim().toLowerCase(), v.trim().toLowerCase()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
}

export function cleanOptions(options: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(options).map(([k, v]) => [k.trim(), v.trim()]));
}

const pick = (options: Record<string, string>, names: string[]): string | null => {
  for (const [k, v] of Object.entries(options)) if (names.includes(k.trim().toLowerCase())) return v;
  return null;
};
export const sizeOf = (o: Record<string, string>): string | null => pick(o, ["talla", "size"]);
export const colorOf = (o: Record<string, string>): string | null => pick(o, ["color", "colour"]);

export function variantDto(v: ProductVariant): Variant {
  return {
    id: v.id,
    sku: v.sku,
    options: v.options,
    priceMinor: toNum(v.priceMinor),
    compareAtMinor: toNum(v.compareAtMinor),
    stockOnHand: v.stockOnHand,
    stockReserved: v.stockReserved,
    stockAvailable: v.stockOnHand - v.stockReserved,
    isActive: v.isActive,
    position: v.position,
  };
}

export const mediaDto = (m: ProductMedia): Media => ({
  id: m.id,
  kind: m.kind,
  variantId: m.variantId,
  alt: m.alt,
  position: m.position,
  url: m.kind === "video_link" ? m.url : null,
});

function productDto(p: ProductRow, variants: ProductVariant[], media: ProductMedia[]): Product {
  return {
    id: p.id,
    sku: p.sku ?? variants.find((v) => v.sku)?.sku ?? "",
    name: p.name,
    unit: p.unit ?? "ud",
    priceMinor: toNumReq(p.priceMinor),
    currency: p.currency,
    taxRateBp: p.taxRateBp,
    source: p.priceSource,
    kind: p.kind,
    status: p.status,
    description: p.description,
    category: p.category,
    tags: p.tags,
    trackStock: p.trackStock,
    version: p.version,
    variants: variants.map(variantDto),
    media: media.map(mediaDto),
  };
}

export async function selectProducts(tx: Transaction, where: Array<SQL | undefined>, limit: number): Promise<{ items: Product[]; sortUs: string[] }> {
  const rows = await tx
    .select({ p: products, sortUs: sql<string>`${PRODUCT_US}::text` })
    .from(products)
    .where(and(...where))
    .orderBy(desc(PRODUCT_US), desc(products.id))
    .limit(limit);
  const ids = rows.map((r) => r.p.id);
  const vs = ids.length
    ? await tx.select().from(productVariants).where(inArray(productVariants.productId, ids)).orderBy(asc(productVariants.position), asc(productVariants.createdAt))
    : [];
  const ms = ids.length
    ? await tx.select().from(productMedia).where(inArray(productMedia.productId, ids)).orderBy(asc(productMedia.position), asc(productMedia.createdAt))
    : [];
  return {
    sortUs: rows.map((r) => r.sortUs),
    items: rows.map((r) =>
      productDto(r.p, vs.filter((v) => v.productId === r.p.id), ms.filter((m) => m.productId === r.p.id)),
    ),
  };
}

export async function loadProduct(tx: Transaction, id: string): Promise<Product | undefined> {
  const page = await selectProducts(tx, [eq(products.id, id)], 1);
  return page.items[0];
}

/** One row per active variant of an active product (quote/order line picker). */
export async function searchVariants(tx: Transaction, q: string | undefined, limit: number): Promise<ProductSearchItem[]> {
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
  const rows = await tx
    .select({ p: products, v: productVariants })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(products.status, "active"),
        eq(productVariants.isActive, true),
        pattern
          ? sql`(${products.name} ilike ${pattern} or ${products.sku} ilike ${pattern} or ${productVariants.sku} ilike ${pattern} or ${productVariants.options}::text ilike ${pattern})`
          : undefined,
      ),
    )
    .orderBy(asc(products.name), asc(productVariants.position), asc(productVariants.id))
    .limit(limit);
  return rows.map(({ p, v }) => ({
    id: p.id,
    variantId: v.id,
    sku: v.sku ?? p.sku ?? "",
    name: p.name,
    unit: p.unit ?? "ud",
    priceMinor: toNumReq(v.priceMinor ?? p.priceMinor),
    currency: p.currency,
    taxRateBp: p.taxRateBp,
    source: p.priceSource,
    variant: Object.keys(v.options).length ? { size: sizeOf(v.options), color: colorOf(v.options) } : null,
    stock: p.trackStock ? v.stockOnHand - v.stockReserved : null,
  }));
}
