import { followUps, messages, tenants, withTenant, type Database } from "@crmwsp/db";
import { resolveFollowUpSettings } from "@crmwsp/domain";
import type { Queue} from "bullmq";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from "bullmq";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Logger } from "../processors.js";
import { SEND_MESSAGE_JOB, SEND_MESSAGE_JOB_OPTIONS, type SendMessageJobData } from "../queue.js";
import { dispatchDue } from "./engine.js";
import { createPgFollowUpStore, createRuleFollowUps } from "./pg-store.js";

export * from "./engine.js";
export { cancelFollowUpsForConversation, cancelFollowUpsForOrder, createPgFollowUpStore, createRuleFollowUps } from "./pg-store.js";

export const FOLLOW_UP_QUEUE_NAME = "followups";
export const FOLLOW_UP_TICK_JOB = "follow-up-tick";
export const FOLLOW_UP_SCHEDULER_ID = "follow-up-tick-every-minute";
export const FOLLOW_UP_TICK_EVERY_MS = 60_000;

export interface FollowUpTickDeps {
  db: Database;
  outboundQueue: Pick<Queue, "add">;
  logger?: Logger;
  now?: () => Date;
}

export interface FollowUpTickResult {
  tenants: number;
  created: number;
  enqueued: number;
  failedTenants: number;
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * One scheduler pass: for each active tenant (own withTenant transaction) create rule follow-ups,
 * dispatch due ones, then — after commit — enqueue the queued messages on the outbound queue
 * (jobId = message id, so BullMQ dedupes re-enqueues). Messages queued by an earlier tick whose
 * enqueue was lost are re-enqueued too.
 */
export async function runFollowUpTick(deps: FollowUpTickDeps): Promise<FollowUpTickResult> {
  const logger = deps.logger ?? silent;
  const rows = await deps.db.execute<{ tenant_id: string }>(sql`select tenant_id from follow_up_tenant_ids()`);
  const res: FollowUpTickResult = { tenants: rows.length, created: 0, enqueued: 0, failedTenants: 0 };
  for (const { tenant_id: tenantId } of rows) {
    try {
      const now = deps.now?.() ?? new Date();
      const toEnqueue = await withTenant(deps.db, tenantId, async (tx) => {
        const [t] = await tx.select({ settings: tenants.settings, timezone: tenants.timezone }).from(tenants);
        const settings = resolveFollowUpSettings(t?.settings?.["followUps"]);
        res.created += await createRuleFollowUps(tx, settings);
        const outcomes = await dispatchDue(createPgFollowUpStore(tx, tenantId), settings, t?.timezone ?? "UTC", now);
        const ids = new Set(outcomes.flatMap((o) => (o.messageId ? [o.messageId] : [])));
        // Recovery: follow-up messages still queued (lost enqueue after a previous commit).
        const stale = await tx
          .select({ id: messages.id })
          .from(followUps)
          .innerJoin(messages, eq(messages.id, followUps.sentMessageId))
          .where(
            and(
              eq(followUps.status, "sent"),
              eq(messages.status, "queued"),
              gt(messages.createdAt, new Date(now.getTime() - 3600_000)),
            ),
          )
          .limit(100);
        for (const s of stale) ids.add(s.id);
        return [...ids];
      });
      for (const messageId of toEnqueue) {
        const data: SendMessageJobData = { tenantId, messageId };
        await deps.outboundQueue.add(SEND_MESSAGE_JOB, data, { ...SEND_MESSAGE_JOB_OPTIONS, jobId: messageId });
        res.enqueued++;
      }
    } catch (err) {
      // One tenant failing (bad data, enqueue down) must not starve the others; the next tick retries.
      res.failedTenants++;
      logger.warn(`follow-up tick failed for a tenant (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}

export interface FollowUpWorkerOptions extends FollowUpTickDeps {
  connection: ConnectionOptions;
  queueName?: string;
}

/** Worker for the follow-up queue (concurrency 1: one tick at a time per process). */
export function createFollowUpWorker(opts: FollowUpWorkerOptions): Worker {
  const { connection, queueName = FOLLOW_UP_QUEUE_NAME, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name !== FOLLOW_UP_TICK_JOB) throw new UnrecoverableError("unknown job name");
      return runFollowUpTick(deps);
    },
    { connection, concurrency: 1 },
  );
}

/** Registers (idempotently) the repeatable tick. */
export async function scheduleFollowUpTick(queue: Pick<Queue, "upsertJobScheduler">, everyMs = FOLLOW_UP_TICK_EVERY_MS): Promise<void> {
  await queue.upsertJobScheduler(
    FOLLOW_UP_SCHEDULER_ID,
    { every: everyMs },
    { name: FOLLOW_UP_TICK_JOB, data: {}, opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } } },
  );
}
