import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  InsufficientStockError,
  NotFoundError,
  ValidationError,
  createOrderRequestSchema,
  listOrdersQuerySchema,
  markPaidRequestSchema,
  type Order,
  type OrderList,
} from "@crmwsp/contracts";
import { contacts, eq, isUuid, orders, sql, type Transaction } from "@crmwsp/db";
import { transitionOrder, type OrderAction } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { pgCode, writeAudit } from "../inbox/audit.js";
import { decodeCursor, encodeCursor } from "../inbox/cursor.js";
import { pgMessage } from "../sales/util.js";
import {
  ORDER_US,
  assertConversationOfContact,
  insertOrderDraft,
  linesFromVariants,
  loadOrder,
  selectOrders,
} from "./orders.service.js";

const INSUFFICIENT = /^insufficient_stock:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Maps the P0001 errors raised by reserve_stock / commit_stock to API errors. */
function mapStockError(err: unknown): never {
  if (pgCode(err) === "P0001") {
    const msg = pgMessage(err) ?? "";
    const m = INSUFFICIENT.exec(msg);
    if (m?.[1]) throw new InsufficientStockError(m[1].toLowerCase());
    if (msg === "stock_already_released") throw new ConflictError("Stock was already released for this order");
  }
  throw err;
}

@Controller("orders")
@UseGuards(TenantGuard)
export class OrdersController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<OrderList> {
    const q = parseOrThrow(listOrdersQuerySchema, query);
    const where = [q.status ? eq(orders.status, q.status) : undefined, q.contactId ? eq(orders.contactId, q.contactId) : undefined];
    if (q.cursor) {
      const cur = decodeCursor(q.cursor);
      where.push(sql`(${ORDER_US}, ${orders.id}) < (${cur.t}::bigint, ${cur.id}::uuid)`);
    }
    const page = await db.run((tx) => selectOrders(tx, where, q.limit + 1));
    const items = page.items.slice(0, q.limit);
    const last = items[items.length - 1];
    const lastUs = page.sortUs[items.length - 1];
    return { items, nextCursor: page.items.length > q.limit && last && lastUs ? encodeCursor({ t: lastUs, id: last.id }) : null };
  }

  @Get(":id")
  async detail(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<Order> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run((tx) => loadOrder(tx, id));
  }

  /** Prices come from the variants on the server. Creates a `draft` (no stock touched yet). */
  @Post()
  @Roles("owner", "admin", "agent")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<Order> {
    const input = parseOrThrow(createOrderRequestSchema, body);
    return db.run(async (tx) => {
      const [c] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId));
      if (!c) throw new NotFoundError();
      if (input.conversationId) await assertConversationOfContact(tx, input.conversationId, input.contactId);
      const { lines, currency } = await linesFromVariants(tx, input.items);
      const id = await insertOrderDraft(tx, {
        tenantId: db.tenantId,
        createdByType: "user",
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        currency,
        lines,
        fulfillment: input.fulfillment,
        shippingAddress: input.shippingAddress ?? null,
        shippingMinor: input.shippingMinor ?? 0,
        notes: input.notes ?? null,
      });
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "order", entityId: id, action: "order.created", diff: { items: lines.length, currency }, ip: req.ip });
      return loadOrder(tx, id);
    });
  }

  /** draft -> pending_payment, reserving stock atomically (409 INSUFFICIENT_STOCK leaves nothing reserved). */
  @Post(":id/confirm")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  confirm(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<Order> {
    return this.transition(db, id, "confirm", req, async (tx) => {
      await tx.execute(sql`select public.reserve_stock(${id}::uuid)`);
    });
  }

  @Post(":id/cancel")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  cancel(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<Order> {
    return this.transition(db, id, "cancel", req, async (tx) => {
      await tx.execute(sql`select public.release_stock(${id}::uuid)`);
    });
  }

  /** Manual payment. Owner/admin only, mandatory reason, audited. Webhook payments arrive in phase 4. */
  @Post(":id/mark-paid")
  @Roles("owner", "admin")
  @HttpCode(200)
  markPaid(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Order> {
    const { reason } = parseOrThrow(markPaidRequestSchema, body);
    return this.transition(
      db,
      id,
      "mark_paid",
      req,
      async (tx) => {
        await tx.execute(sql`select public.commit_stock(${id}::uuid)`);
      },
      // orders has no verified_by column yet (phase 4): the audit row carries it. Never "webhook" here.
      { reason: `pago manual: ${reason}`, diff: { method: "manual", verifiedBy: "manual", reason } },
    );
  }

  @Post(":id/fulfill")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  fulfill(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<Order> {
    return this.transition(db, id, "fulfill", req);
  }

  @Post(":id/ship")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  ship(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<Order> {
    return this.transition(db, id, "ship", req);
  }

  @Post(":id/deliver")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  deliver(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<Order> {
    return this.transition(db, id, "deliver", req);
  }

  private async transition(
    db: TenantDb,
    id: string,
    action: OrderAction,
    req: HttpRequest,
    sideEffect?: (tx: Transaction) => Promise<void>,
    audit?: { reason: string; diff: Record<string, unknown> },
  ): Promise<Order> {
    if (!isUuid(id)) throw new NotFoundError();
    try {
      return await db.run(async (tx) => {
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
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "order",
          entityId: id,
          action: `order.${action}`,
          diff: { status: { from: o.status, to: t.to }, ...(audit?.diff ?? {}) },
          ip: req.ip,
          reason: audit?.reason,
        });
        return loadOrder(tx, id);
      });
    } catch (err) {
      return mapStockError(err);
    }
  }
}
