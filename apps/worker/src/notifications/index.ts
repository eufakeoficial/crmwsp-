import { resolveNotificationSettings, type NotificationEvent } from "@crmwsp/contracts";
import {
  channelConnections,
  contacts,
  conversations,
  messages,
  notifications,
  tenants,
  withTenant,
  type Database,
  type Transaction,
} from "@crmwsp/db";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { tenantChannel, type EventPublisher, type Logger } from "../processors.js";
import { SEND_MESSAGE_JOB, SEND_MESSAGE_JOB_OPTIONS, type SendMessageJobData } from "../queue.js";
import { runReminderTick } from "../inbox/reminders.js";
import { dispatchNotifications, type NotificationStore } from "./engine.js";

export * from "./engine.js";
export * from "./notify.js";

export const NOTIFICATION_QUEUE_NAME = "notifications";
export const NOTIFICATION_TICK_JOB = "notification-tick";
export const NOTIFICATION_SCHEDULER_ID = "notification-tick-every-10s";
export const NOTIFICATION_TICK_EVERY_MS = 10_000;

export interface NotificationTickDeps {
  db: Database;
  publisher: EventPublisher;
  outboundQueue: Pick<Queue, "add">;
  logger?: Logger;
  now?: () => Date;
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Postgres adapter; `tx` comes from withTenant so RLS scopes every query. */
export function createPgNotificationStore(tx: Transaction, tenantId: string): NotificationStore {
  return {
    async lockUndispatched(limit) {
      return tx
        .select({ id: notifications.id, kind: notifications.kind, title: notifications.title, body: notifications.body })
        .from(notifications)
        .where(isNull(notifications.dispatchedAt))
        .orderBy(notifications.createdAt)
        .limit(limit)
        .for("update", { skipLocked: true });
    },
    async ownerConversation(phoneE164) {
      const [row] = await tx
        .select({
          conversationId: conversations.id,
          lastInboundAt: conversations.lastInboundAt,
          channelStatus: channelConnections.status,
        })
        .from(contacts)
        .innerJoin(conversations, eq(conversations.contactId, contacts.id))
        .innerJoin(channelConnections, eq(channelConnections.id, conversations.channelConnectionId))
        .where(eq(contacts.phoneE164, phoneE164))
        .orderBy(sql`${conversations.lastInboundAt} desc nulls last`, desc(conversations.id))
        .limit(1);
      return row
        ? { conversationId: row.conversationId, lastInboundAt: row.lastInboundAt, channelActive: row.channelStatus !== "disabled" }
        : null;
    },
    async insertOwnerMessage(n, conversationId, body) {
      const [ins] = await tx
        .insert(messages)
        .values({
          tenantId,
          conversationId,
          direction: "outbound",
          type: "text",
          body,
          status: "queued",
          author: "system",
          clientMessageId: n.id,
        })
        .onConflictDoNothing({
          target: [messages.tenantId, messages.clientMessageId],
          where: sql`${messages.clientMessageId} is not null`,
        })
        .returning({ id: messages.id });
      if (ins) return ins.id;
      const [existing] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.clientMessageId, n.id));
      if (!existing) throw new Error("owner message conflict without row");
      return existing.id;
    },
    async markDispatched(id, outcome, now) {
      await tx
        .update(notifications)
        .set({
          dispatchedAt: now,
          whatsappStatus: outcome.status,
          whatsappSkipReason: outcome.status === "skipped" ? outcome.reason : null,
          whatsappMessageId: outcome.status === "sent" ? outcome.messageId : null,
        })
        .where(and(eq(notifications.id, id), isNull(notifications.dispatchedAt)));
    },
  };
}

export interface NotificationTickResult {
  tenants: number;
  dispatched: number;
  sent: number;
  failedTenants: number;
}

/**
 * One pass: per tenant with undispatched notifications (own transaction) decide the owner WhatsApp
 * leg, then — after commit — enqueue owner messages and publish `notification.created` (SSE).
 */
export async function runNotificationTick(deps: NotificationTickDeps): Promise<NotificationTickResult> {
  const logger = deps.logger ?? silent;
  // Due reminders (T23) become notifications first, so this same pass delivers them.
  try {
    await runReminderTick(deps.db, deps.now?.() ?? new Date(), logger);
  } catch (err) {
    logger.warn(`reminder tick failed (${err instanceof Error ? err.name : "unknown"})`);
  }
  const rows = await deps.db.execute<{ tenant_id: string }>(sql`select tenant_id from notification_tenant_ids()`);
  const res: NotificationTickResult = { tenants: rows.length, dispatched: 0, sent: 0, failedTenants: 0 };
  for (const { tenant_id: tenantId } of rows) {
    try {
      const now = deps.now?.() ?? new Date();
      const out = await withTenant(deps.db, tenantId, async (tx) => {
        const [t] = await tx.select({ settings: tenants.settings }).from(tenants);
        const settings = resolveNotificationSettings(t?.settings?.["notifications"]);
        return dispatchNotifications(createPgNotificationStore(tx, tenantId), settings, now);
      });
      for (const s of out.skipped) logger.info(`owner whatsapp notification ${s.id} skipped (${s.reason})`);
      for (const messageId of out.messageIds) {
        const data: SendMessageJobData = { tenantId, messageId };
        await deps.outboundQueue.add(SEND_MESSAGE_JOB, data, { ...SEND_MESSAGE_JOB_OPTIONS, jobId: messageId });
      }
      for (const n of out.notificationIds) {
        const event: NotificationEvent = { type: "notification.created", notificationId: n.id, kind: n.kind };
        try {
          await deps.publisher.publish(tenantChannel(tenantId), JSON.stringify(event));
        } catch (err) {
          logger.warn(`notification publish failed (${err instanceof Error ? err.name : "unknown"})`);
        }
      }
      res.dispatched += out.notificationIds.length;
      res.sent += out.messageIds.length;
    } catch (err) {
      // One tenant failing must not starve the others; the next tick retries.
      res.failedTenants++;
      logger.warn(`notification tick failed for a tenant (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}

export interface NotificationWorkerOptions extends NotificationTickDeps {
  connection: ConnectionOptions;
  queueName?: string;
}

/** Worker for the notification queue (concurrency 1: one tick at a time per process). */
export function createNotificationWorker(opts: NotificationWorkerOptions): Worker {
  const { connection, queueName = NOTIFICATION_QUEUE_NAME, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name !== NOTIFICATION_TICK_JOB) throw new UnrecoverableError("unknown job name");
      return runNotificationTick(deps);
    },
    { connection, concurrency: 1 },
  );
}

/** Registers (idempotently) the repeatable tick. */
export async function scheduleNotificationTick(
  queue: Pick<Queue, "upsertJobScheduler">,
  everyMs = NOTIFICATION_TICK_EVERY_MS,
): Promise<void> {
  await queue.upsertJobScheduler(
    NOTIFICATION_SCHEDULER_ID,
    { every: everyMs },
    { name: NOTIFICATION_TICK_JOB, data: {}, opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } } },
  );
}
