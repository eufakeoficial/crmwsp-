import { ConflictError, NotFoundError, ValidationError, type Order } from "@crmwsp/contracts";
import { transitionOrder, type OrderAction } from "@crmwsp/domain";
import { writeAudit } from "../inbox/audit.js";
import { insertNotification } from "../notifications/notify.js";
import { emitOrderWebhook } from "../developers/order-events.js";
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
  await emitOrderWebhook(tx, o.tenantId, "order.created", row.id);
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

export interface TransitionCtx {
  tenantId: string;
  userId: string;
  ip?: string | undefined;
}

export interface TransitionAudit {
  reason: string;
  diff: Record<string, unknown>;
}

/**
 * Applies an order state transition inside `tx` (row locked FOR UPDATE), with its side effect,
 * an audit row and — for confirm/mark_paid — a team notification. Shared by the orders controller
 * and the payment-review approval (which uses the same manual mark-paid path).
 */
export async function transitionOrderTx(
  tx: Transaction,
  ctx: TransitionCtx,
  id: string,
  action: OrderAction,
  sideEffect?: (tx: Transaction) => Promise<void>,
  audit?: TransitionAudit,
): Promise<Order> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  if (!o) throw new NotFoundError();
  const t = transitionOrder(o.status, action, o.fulfillment);
  if (!t.ok) {
    if (t.reason === "not_applicable") throw new ValidationError(`'${action}' does not apply to ${o.fulfillment} orders`);
    throw new ConflictError(`Cannot ${action.replace("_", "-")} an order that is ${o.status}`);
  }
  if (sideEffect) await sideEffect(tx);
  const now = new Date();
  await tx
    .update(orders)
    .set({
      status: t.to,
      ...(t.to === "paid" ? { paidAt: now } : {}),
      ...(t.to === "cancelled" ? { cancelledAt: now } : {}),
      lockVersion: sql`${orders.lockVersion} + 1`,
      updatedAt: now,
    })
    .where(eq(orders.id, id));
  await writeAudit(tx, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    entity: "order",
    entityId: id,
    action: `order.${action}`,
    diff: { status: { from: o.status, to: t.to }, ...(audit?.diff ?? {}) },
    ip: ctx.ip,
    reason: audit?.reason,
  });
  if (action === "confirm") {
    await insertNotification(tx, ctx.tenantId, {
      kind: "order_confirmed",
      title: `Pedido ${o.number} confirmado`,
      body: `Total ${(Number(o.totalMinor) / 100).toFixed(2)} ${o.currency}. Pendiente de pago.`,
      entity: "order",
      entityId: id,
      conversationId: o.conversationId,
      dedupeKey: `order_confirmed:${id}`,
    });
  } else if (t.to === "paid") {
    await emitOrderWebhook(tx, ctx.tenantId, "order.paid", id);
    await insertNotification(tx, ctx.tenantId, {
      kind: "order_paid",
      title: `Pedido ${o.number} pagado`,
      body: `Pago manual registrado: ${(Number(o.totalMinor) / 100).toFixed(2)} ${o.currency}.`,
      entity: "order",
      entityId: id,
      conversationId: o.conversationId,
      dedupeKey: `order_paid:${id}`,
    });
  }
  return loadOrder(tx, id);
}

/** Manual mark-paid (owner/admin, audited). `verifiedBy` is never "webhook" here. */
export function markPaidManuallyTx(
  tx: Transaction,
  ctx: TransitionCtx,
  id: string,
  input: { reason: string; paymentReviewId?: string },
): Promise<Order> {
  return transitionOrderTx(
    tx,
    ctx,
    id,
    "mark_paid",
    async (t) => {
      await t.execute(sql`select public.commit_stock(${id}::uuid)`);
    },
    {
      reason: `pago manual: ${input.reason}`,
      diff: {
        method: input.paymentReviewId ? "receipt_review" : "manual",
        verifiedBy: "manual",
        verifiedByUserId: ctx.userId,
        reason: input.reason,
        ...(input.paymentReviewId ? { paymentReviewId: input.paymentReviewId } : {}),
      },
    },
  );
}
