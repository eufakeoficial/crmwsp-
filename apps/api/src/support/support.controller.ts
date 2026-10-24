import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  createSupportTicketRequestSchema,
  supportReplyRequestSchema,
  supportTicketListQuerySchema,
  uuidSchema,
  type SupportMessage,
  type SupportTicket,
  type SupportTicketList,
  type SupportTicketThread,
  type SupportUnread,
} from "@crmwsp/contracts";
import { and, asc, desc, eq, sql, supportMessages, supportTickets, users, type Transaction } from "@crmwsp/db";

type SQL = ReturnType<typeof eq>;
import { canTenantClose, canViewSupportTicket, seesAllSupportTickets, statusAfterTenantReply } from "@crmwsp/domain";
import { UseGuards } from "@nestjs/common";
import { InMemoryRateLimiter, type RateLimitOptions } from "../auth/rate-limiter.js";
import { CurrentTenant, CurrentTenantDb, CurrentUser } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { RequestTenant, RequestUser } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { RealtimeHub } from "../events/realtime.hub.js";

export const SUPPORT_CREATE_RATE_LIMIT = Symbol("SUPPORT_CREATE_RATE_LIMIT");
/** Per user and tenant: new tickets (replies are not limited here). */
export const DEFAULT_SUPPORT_CREATE_RATE_LIMIT: RateLimitOptions = { limit: 10, windowMs: 60 * 60 * 1000 };

const ticketColumns = {
  id: supportTickets.id,
  number: supportTickets.number,
  subject: supportTickets.subject,
  category: supportTickets.category,
  priority: supportTickets.priority,
  status: supportTickets.status,
  createdBy: supportTickets.createdBy,
  creatorName: users.name,
  creatorEmail: users.email,
  assigneeId: supportTickets.assigneeId,
  tenantUnread: supportTickets.tenantUnread,
  lastMessageAt: supportTickets.lastMessageAt,
  createdAt: supportTickets.createdAt,
  resolvedAt: supportTickets.resolvedAt,
};

type TicketRow = {
  id: string;
  number: number;
  subject: string;
  category: SupportTicket["category"];
  priority: SupportTicket["priority"];
  status: SupportTicket["status"];
  createdBy: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  assigneeId: string | null;
  tenantUnread: boolean;
  lastMessageAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
};

/** Platform admins are not tenant members, so their identity is never exposed to the tenant. */
function toTicket(r: TicketRow): SupportTicket {
  return {
    id: r.id,
    number: r.number,
    subject: r.subject,
    category: r.category,
    priority: r.priority,
    status: r.status,
    createdBy: { id: r.createdBy, name: r.creatorName, email: r.creatorEmail },
    assignee: r.assigneeId ? { id: null, name: null } : null,
    unread: r.tenantUnread,
    lastMessageAt: r.lastMessageAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  };
}

function visibility(user: RequestUser, tenant: RequestTenant): SQL | undefined {
  return seesAllSupportTickets(tenant.role) ? undefined : eq(supportTickets.createdBy, user.id);
}

async function loadVisible(tx: Transaction, id: string, user: RequestUser, tenant: RequestTenant, lock = false): Promise<TicketRow> {
  const q = tx.select(ticketColumns).from(supportTickets).leftJoin(users, eq(users.id, supportTickets.createdBy)).where(eq(supportTickets.id, id));
  const [row] = lock ? await q.for("update", { of: supportTickets }) : await q;
  // Not visible = not found (do not reveal other members' tickets).
  if (!row || !canViewSupportTicket({ userId: user.id, role: tenant.role }, row.createdBy)) throw new NotFoundError();
  return row as TicketRow;
}

async function loadMessages(tx: Transaction, ticketId: string): Promise<SupportMessage[]> {
  // RLS already hides internal notes from the app role; the filter keeps it explicit.
  const rows = await tx
    .select({
      id: supportMessages.id,
      authorType: supportMessages.authorType,
      authorName: users.name,
      body: supportMessages.body,
      internal: supportMessages.internal,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .leftJoin(users, eq(users.id, supportMessages.authorUserId))
    .where(and(eq(supportMessages.ticketId, ticketId), eq(supportMessages.internal, false)))
    .orderBy(asc(supportMessages.createdAt), asc(supportMessages.id))
    .limit(1000);
  return rows.map((m) => ({
    id: m.id,
    authorType: m.authorType,
    authorName: m.authorType === "platform_admin" ? null : m.authorName,
    body: m.body,
    internal: false,
    createdAt: m.createdAt.toISOString(),
  }));
}

/**
 * Tenant side of support tickets (ADR 0016). Any member may open tickets; owners/admins see all
 * of the tenant, other members only their own. Changes are pushed to the platform support inbox
 * and to the tenant stream (other viewers refresh).
 */
@Controller("support")
@UseGuards(TenantGuard)
export class SupportController {
  private readonly limiter: InMemoryRateLimiter;

  constructor(
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(SUPPORT_CREATE_RATE_LIMIT) rateLimit: RateLimitOptions,
  ) {
    this.limiter = new InMemoryRateLimiter(rateLimit);
  }

  private async notify(tenantId: string, ticketId: string): Promise<void> {
    const event = { type: "support.ticket_updated", ticketId } as const;
    await Promise.all([this.hub.publishPlatformSupport(event), this.hub.publish(tenantId, event)]);
  }

  @Get("tickets")
  async list(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Query() query: unknown,
  ): Promise<SupportTicketList> {
    const q = parseOrThrow(supportTicketListQuerySchema, query);
    const conds = [visibility(user, tenant), q.status ? eq(supportTickets.status, q.status) : undefined].filter((c): c is SQL => c !== undefined);
    const rows = await db.run((tx) =>
      tx
        .select(ticketColumns)
        .from(supportTickets)
        .leftJoin(users, eq(users.id, supportTickets.createdBy))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(supportTickets.lastMessageAt), desc(supportTickets.id))
        .limit(200),
    );
    return { items: (rows as TicketRow[]).map(toTicket) };
  }

  @Get("unread-count")
  async unread(@CurrentTenantDb() db: TenantDb, @CurrentUser() user: RequestUser, @CurrentTenant() tenant: RequestTenant): Promise<SupportUnread> {
    const vis = visibility(user, tenant);
    const [row] = await db.run((tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(supportTickets)
        .where(vis ? and(eq(supportTickets.tenantUnread, true), vis) : eq(supportTickets.tenantUnread, true)),
    );
    return { unreadCount: row?.n ?? 0 };
  }

  @Post("tickets")
  async create(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Body() body: unknown,
  ): Promise<SupportTicketThread> {
    const input = parseOrThrow(createSupportTicketRequestSchema, body);
    this.limiter.consume(`support:create:${tenant.id}:${user.id}`);
    const thread = await db.run(async (tx) => {
      const [t] = await tx
        .insert(supportTickets)
        .values({ tenantId: db.tenantId, subject: input.subject, category: input.category, priority: input.priority, createdBy: user.id })
        .returning({ id: supportTickets.id });
      if (!t) throw new Error("support ticket insert returned nothing");
      await tx.insert(supportMessages).values({ tenantId: db.tenantId, ticketId: t.id, authorType: "tenant_user", authorUserId: user.id, body: input.message });
      return { ticket: toTicket(await loadVisible(tx, t.id, user, tenant)), messages: await loadMessages(tx, t.id) };
    });
    await this.notify(db.tenantId, thread.ticket.id);
    return thread;
  }

  /** Opening the thread marks the admin replies as read for the tenant. */
  @Get("tickets/:id")
  async thread(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
  ): Promise<SupportTicketThread> {
    const ticketId = parseOrThrow(uuidSchema, id);
    return db.run(async (tx) => {
      const row = await loadVisible(tx, ticketId, user, tenant);
      if (row.tenantUnread) {
        await tx.update(supportTickets).set({ tenantUnread: false }).where(eq(supportTickets.id, ticketId));
        row.tenantUnread = false;
      }
      return { ticket: toTicket(row), messages: await loadMessages(tx, ticketId) };
    });
  }

  @Post("tickets/:id/messages")
  async reply(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<SupportTicketThread> {
    const ticketId = parseOrThrow(uuidSchema, id);
    const input = parseOrThrow(supportReplyRequestSchema, body);
    const thread = await db.run(async (tx) => {
      const row = await loadVisible(tx, ticketId, user, tenant, true);
      const status = statusAfterTenantReply(row.status);
      await tx.insert(supportMessages).values({ tenantId: db.tenantId, ticketId, authorType: "tenant_user", authorUserId: user.id, body: input.body });
      const now = new Date();
      await tx
        .update(supportTickets)
        .set({ status, resolvedAt: status === "resolved" ? row.resolvedAt : null, adminUnread: true, tenantUnread: false, lastMessageAt: now, updatedAt: now })
        .where(eq(supportTickets.id, ticketId));
      return { ticket: toTicket(await loadVisible(tx, ticketId, user, tenant)), messages: await loadMessages(tx, ticketId) };
    });
    await this.notify(db.tenantId, ticketId);
    return thread;
  }

  @Post("tickets/:id/close")
  @HttpCode(200)
  async close(
    @CurrentTenantDb() db: TenantDb,
    @CurrentUser() user: RequestUser,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
  ): Promise<SupportTicket> {
    const ticketId = parseOrThrow(uuidSchema, id);
    const ticket = await db.run(async (tx) => {
      const row = await loadVisible(tx, ticketId, user, tenant, true);
      if (!canTenantClose(row.status)) throw new ConflictError("Ticket already resolved");
      const now = new Date();
      await tx.update(supportTickets).set({ status: "resolved", resolvedAt: now, updatedAt: now }).where(eq(supportTickets.id, ticketId));
      return toTicket(await loadVisible(tx, ticketId, user, tenant));
    });
    await this.notify(db.tenantId, ticketId);
    return ticket;
  }
}
