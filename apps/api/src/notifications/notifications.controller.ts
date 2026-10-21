import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import {
  listNotificationsQuerySchema,
  markNotificationsReadRequestSchema,
  type Notification,
  type NotificationList,
} from "@crmwsp/contracts";
import { and, desc, eq, gt, inArray, notificationReads, notifications, sql, type Transaction } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";

/** Notifications older than this are not listed nor counted as unread. */
export const NOTIFICATION_WINDOW_DAYS = 30;

const windowStart = (): Date => new Date(Date.now() - NOTIFICATION_WINDOW_DAYS * 24 * 3600 * 1000);

export async function unreadCount(tx: Transaction, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        gt(notifications.createdAt, windowStart()),
        sql`not exists (select 1 from ${notificationReads} r where r.notification_id = ${notifications.id} and r.user_id = ${userId}::uuid)`,
      ),
    );
  return row?.n ?? 0;
}

/** Team notification feed (tenant-scoped by RLS; read state per user). */
@Controller("notifications")
@UseGuards(TenantGuard)
export class NotificationsController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<NotificationList> {
    const q = parseOrThrow(listNotificationsQuerySchema, query);
    return db.run(async (tx) => {
      const rows = await tx
        .select({ n: notifications, readAt: notificationReads.readAt })
        .from(notifications)
        .leftJoin(
          notificationReads,
          and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, db.userId)),
        )
        .where(and(gt(notifications.createdAt, windowStart()), q.unreadOnly ? sql`${notificationReads.readAt} is null` : undefined))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(q.limit);
      const items: Notification[] = rows.map(({ n, readAt }) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        entity: n.entity,
        entityId: n.entityId,
        conversationId: n.conversationId,
        read: readAt !== null,
        createdAt: n.createdAt.toISOString(),
      }));
      return { items, unreadCount: await unreadCount(tx, db.userId) };
    });
  }

  @Get("unread-count")
  async count(@CurrentTenantDb() db: TenantDb): Promise<{ unreadCount: number }> {
    return { unreadCount: await db.run((tx) => unreadCount(tx, db.userId)) };
  }

  /** Marks some (or all recent) notifications as read for the current user. Idempotent. */
  @Post("read")
  // Per-user read state of the caller's own notifications: harmless for viewers.
  @Roles("owner", "admin", "agent", "viewer")
  @HttpCode(200)
  async markRead(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<{ unreadCount: number }> {
    const input = parseOrThrow(markNotificationsReadRequestSchema, body);
    return db.run(async (tx) => {
      const ids =
        "ids" in input
          ? (await tx.select({ id: notifications.id }).from(notifications).where(inArray(notifications.id, input.ids))).map((r) => r.id)
          : (await tx.select({ id: notifications.id }).from(notifications).where(gt(notifications.createdAt, windowStart()))).map((r) => r.id);
      if (ids.length > 0) {
        await tx
          .insert(notificationReads)
          .values(ids.map((id) => ({ tenantId: db.tenantId, notificationId: id, userId: db.userId })))
          .onConflictDoNothing();
      }
      return { unreadCount: await unreadCount(tx, db.userId) };
    });
  }
}
