import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import {
  NotFoundError,
  publicListQuerySchema,
  type PublicContact,
  type PublicOrder,
  type PublicOrderDetail,
  type PublicPage,
} from "@crmwsp/contracts";
import { asc, contacts, desc, eq, isUuid, orderItems, orders, sql, withTenant, type Contact, type Order } from "@crmwsp/db";
import { Public } from "../auth/decorators.js";
import { DB_HANDLE, type DbHandle } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import { decodeCursor, encodeCursor } from "../inbox/cursor.js";
import { ApiKeyGuard, CurrentApiPrincipal, RequireScope, type ApiPrincipal } from "./api-key.guard.js";

const ORDER_US = sql`(extract(epoch from ${orders.createdAt}) * 1000000)::bigint`;
const CONTACT_US = sql`(extract(epoch from ${contacts.createdAt}) * 1000000)::bigint`;

function toPublicOrder(o: Order): PublicOrder {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    currency: o.currency,
    totalMinor: o.totalMinor.toString(),
    contactId: o.contactId,
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

function toPublicContact(c: Contact): PublicContact {
  return { id: c.id, name: c.name, phoneE164: c.phoneE164, createdAt: c.createdAt.toISOString() };
}

/**
 * Public REST API v1, authenticated by tenant API keys (not sessions). Every query runs inside
 * withTenant(apiKey.tenantId), so RLS scopes it to the key's tenant. Newest first, keyset cursor.
 */
@Controller("v1")
@Public()
@UseGuards(ApiKeyGuard)
export class PublicApiController {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  @Get("orders")
  @RequireScope("read:orders")
  async listOrders(@CurrentApiPrincipal() p: ApiPrincipal, @Query() query: unknown): Promise<PublicPage<PublicOrder>> {
    const q = parseOrThrow(publicListQuerySchema, query);
    const c = q.cursor ? decodeCursor(q.cursor) : null;
    const rows = await withTenant(this.handle.db, p.tenantId, (tx) =>
      tx
        .select({ o: orders, us: sql<string>`${ORDER_US}::text` })
        .from(orders)
        .where(c ? sql`(${ORDER_US}, ${orders.id}) < (${c.t}::bigint, ${c.id}::uuid)` : undefined)
        .orderBy(desc(ORDER_US), desc(orders.id))
        .limit(q.limit + 1),
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((r) => toPublicOrder(r.o)),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.us, id: last.o.id }) : null,
    };
  }

  @Get("orders/:id")
  @RequireScope("read:orders")
  async getOrder(@CurrentApiPrincipal() p: ApiPrincipal, @Param("id") id: string): Promise<PublicOrderDetail> {
    if (!isUuid(id)) throw new NotFoundError();
    return withTenant(this.handle.db, p.tenantId, async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id));
      if (!o) throw new NotFoundError();
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.id));
      return {
        ...toPublicOrder(o),
        items: items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitPriceMinor: i.unitPriceMinor.toString(),
          lineTotalMinor: i.lineTotalMinor.toString(),
        })),
      };
    });
  }

  @Get("contacts")
  @RequireScope("read:contacts")
  async listContacts(@CurrentApiPrincipal() p: ApiPrincipal, @Query() query: unknown): Promise<PublicPage<PublicContact>> {
    const q = parseOrThrow(publicListQuerySchema, query);
    const c = q.cursor ? decodeCursor(q.cursor) : null;
    const rows = await withTenant(this.handle.db, p.tenantId, (tx) =>
      tx
        .select({ c: contacts, us: sql<string>`${CONTACT_US}::text` })
        .from(contacts)
        .where(c ? sql`(${CONTACT_US}, ${contacts.id}) < (${c.t}::bigint, ${c.id}::uuid)` : undefined)
        .orderBy(desc(CONTACT_US), desc(contacts.id))
        .limit(q.limit + 1),
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((r) => toPublicContact(r.c)),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.us, id: last.c.id }) : null,
    };
  }
}
