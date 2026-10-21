import { conversationReminders, withTenant, type Database } from "@crmwsp/db";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { insertNotification } from "../notifications/notify.js";
import type { Logger } from "../processors.js";

export interface ReminderTickResult {
  tenants: number;
  notified: number;
  failedTenants: number;
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Turns due reminders into team notifications (kind `reminder`, dedupe `reminder:<id>`). Runs at
 * the start of the notification tick, so the same pass publishes them over SSE. Idempotent:
 * `notified_at` marks the reminder and the dedupe key absorbs replays.
 */
export async function runReminderTick(db: Database, now: Date, logger: Logger = silent): Promise<ReminderTickResult> {
  const rows = await db.execute<{ tenant_id: string }>(sql`select tenant_id from reminder_tenant_ids()`);
  const res: ReminderTickResult = { tenants: rows.length, notified: 0, failedTenants: 0 };
  for (const { tenant_id: tenantId } of rows) {
    try {
      res.notified += await withTenant(db, tenantId, async (tx) => {
        const due = await tx
          .select({
            id: conversationReminders.id,
            conversationId: conversationReminders.conversationId,
            note: conversationReminders.note,
          })
          .from(conversationReminders)
          .where(
            and(
              eq(conversationReminders.done, false),
              isNull(conversationReminders.notifiedAt),
              lte(conversationReminders.remindAt, now),
            ),
          )
          .orderBy(conversationReminders.remindAt)
          .limit(200)
          .for("update", { skipLocked: true });
        for (const r of due) {
          await insertNotification(tx, tenantId, {
            kind: "reminder",
            title: "Recordatorio de conversación",
            body: r.note,
            entity: "conversation_reminder",
            entityId: r.id,
            conversationId: r.conversationId,
            dedupeKey: `reminder:${r.id}`,
          });
          await tx.update(conversationReminders).set({ notifiedAt: now, updatedAt: now }).where(eq(conversationReminders.id, r.id));
        }
        return due.length;
      });
    } catch (err) {
      res.failedTenants++;
      logger.warn(`reminder tick failed for a tenant (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}
