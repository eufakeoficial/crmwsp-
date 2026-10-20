import { NotFoundError, ValidationError, type Order } from "@crmwsp/contracts";
import {
  and,
  contacts,
  conversations,
  desc,
  eq,
  inArray,
  orderItems,
  orders,
  productVariants,
  products,
  sql,
  type Order as OrderRow,
  type Transaction,
} from "@crmwsp/db";
import { buildLine, nextNumber, totalsOf, variantLabel, type ResolvedLine } from "../sales/quote.service.js";
import { iso, toNumReq } from "../sales/util.js";

type SQL = ReturnType<typeof sql>;

export const ORDER_US = sql`(extract(epoch from ${orders.createdAt}) * 1000000)::bigint`;

export interface OrderLine extends ResolvedLine {
  variantId: string | null;
  options: Record<string, string>;
  quantity: number;
}

export interface NewOrder {
  tenantId: string;
  createdByType: "user" | "ai";
  contactId: string;
  conversationId?: string | null;
  opportunityId?: string | null;
  quoteId?: string | null;
  currency: string;
  lines: OrderLine[];
  fulfillment: OrderRow["fulfillment"];
  shippingAddress?: Record<string, unknown> | null;
  shippingMinor?: number;
  notes?: string | null;
}

/** Inserts a `draft` order with its items; numbers via next_document_number('order'). */
export async function insertOrderDraft(tx: Transaction, o: NewOrder): Promise<string> {
  const shipping = BigInt(o.shippingMinor ?? 0);
  const totals = totalsOf(o.lines);
  const number = await nextNumber(tx, "order");
  const [row] = await tx
    .insert(orders)
    .values({
      tenantId: o.tenantId,
      number,
      contactId: o.contactId,
      conversationId: o.conversationId ?? null,
      opportunityId: o.opportunityId ?? null,
      quoteId: o.quoteId ?? null,
      status: "draft",
      currency: o.currency,
      subtotalMinor: totals.subtotal,
      discountMinor: totals.discount,
      shippingMinor: shipping,
      taxMinor: totals.tax,
      totalMinor: totals.total + shipping,
      fulfillment: o.fulfillment,
      shippingAddress: o.shippingAddress ?? null,
      notes: o.notes ?? null,
      createdByType: o.createdByType,
    })
    .returning({ id: orders.id });
  if (!row) throw new Error("insert returned no row");
  await tx.insert(orderItems).values(
    o.lines.map((l) => ({
      tenantId: o.tenantId,
      orderId: row.id,
      variantId: l.variantId,
      productId: l.productId,
      description: l.description,
      options: l.options,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      discountBp: l.discountBp,
      taxRateBp: l.taxRateBp,
      lineTotalMinor: l.lineTotalMinor,
    })),
  );
  return row.id;
}

/** Prices order lines from variants on the server (client only sends variantId + quantity). */
export async function linesFromVariants(
  tx: Transaction,
  items: ReadonlyArray<{ variantId: string; quantity: number }>,
): Promise<{ lines: OrderLine[]; currency: string }> {
  const ids = [...new Set(items.map((i) => i.variantId))];
  const rows = await tx
    .select({ v: productVariants, p: products })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, ids));
  const byId = new Map(rows.map((r) => [r.v.id, r]));
  const currencies = new Set<string>();
  const lines = items.map((it) => {
    const r = byId.get(it.variantId);
    if (!r) throw new NotFoundError();
    if (!r.v.isActive || r.p.status !== "active") throw new ValidationError("Product variant is not available");
    currencies.add(r.p.currency);
    const line = buildLine({
      productId: r.p.id,
      productVersion: r.p.version,
      description: variantLabel(r.p.name, r.v.options),
      quantityMilli: BigInt(it.quantity) * 1000n,
      unit: r.p.unit ?? "ud",
      unitPriceMinor: r.v.priceMinor ?? r.p.priceMinor,
      discountBp: 0,
      taxRateBp: r.p.taxRateBp,
    });
    return { ...line, variantId: r.v.id, options: r.v.options, quantity: it.quantity };
  });
  if (currencies.size !== 1) throw new ValidationError("All items must share one currency");
  return { lines, currency: [...currencies][0] as string };
}

export async function selectOrders(tx: Transaction, where: Array<SQL | undefined>, limit: number): Promise<{ items: Order[]; sortUs: string[] }> {
  const rows = await tx
    .select({ o: orders, contactName: contacts.name, contactPhone: contacts.phoneE164, sortUs: sql<string>`${ORDER_US}::text` })
    .from(orders)
    .innerJoin(contacts, eq(contacts.id, orders.contactId))
    .where(and(...where))
    .orderBy(desc(ORDER_US), desc(orders.id))
    .limit(limit);
  const ids = rows.map((r) => r.o.id);
  const items = ids.length ? await tx.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(orderItems.id) : [];
  return {
    sortUs: rows.map((r) => r.sortUs),
    items: rows.map(({ o, contactName, contactPhone }) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      currency: o.currency,
      contact: { id: o.contactId, name: contactName, phoneE164: contactPhone },
      conversationId: o.conversationId,
      opportunityId: o.opportunityId,
      quoteId: o.quoteId,
      fulfillment: o.fulfillment,
      shippingAddress: o.shippingAddress,
      notes: o.notes,
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          id: i.id,
          variantId: i.variantId,
          productId: i.productId,
          description: i.description,
          options: i.options,
          quantity: i.quantity,
          unitPriceMinor: toNumReq(i.unitPriceMinor),
          discountBp: i.discountBp,
          taxRateBp: i.taxRateBp,
          lineTotalMinor: toNumReq(i.lineTotalMinor),
        })),
      subtotalMinor: toNumReq(o.subtotalMinor),
      discountMinor: toNumReq(o.discountMinor),
      shippingMinor: toNumReq(o.shippingMinor),
      taxMinor: toNumReq(o.taxMinor),
      totalMinor: toNumReq(o.totalMinor),
      stockState: o.stockState,
      paidAt: iso(o.paidAt),
      cancelledAt: iso(o.cancelledAt),
      createdByType: o.createdByType,
      lockVersion: o.lockVersion,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
  };
}

export async function loadOrder(tx: Transaction, id: string): Promise<Order> {
  const [o] = (await selectOrders(tx, [eq(orders.id, id)], 1)).items;
  if (!o) throw new NotFoundError();
  return o;
}

export async function assertConversationOfContact(tx: Transaction, conversationId: string, contactId: string): Promise<void> {
  const [c] = await tx.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, conversationId));
  if (!c) throw new NotFoundError();
  if (c.contactId !== contactId) throw new ValidationError("The conversation belongs to another contact");
}
