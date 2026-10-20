import { withTenant, type Database } from "@crmwsp/db";
import type { Queue } from "bullmq";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from "bullmq";
import { sql } from "drizzle-orm";
import type { Logger } from "../processors.js";
import { SEND_MESSAGE_JOB, SEND_MESSAGE_JOB_OPTIONS, type SendMessageJobData } from "../queue.js";
import { runBroadcastPass } from "./engine.js";
import { createPgBroadcastStore, staleBroadcastMessages } from "./pg-store.js";

export * from "./engine.js";
export { applyBroadcastStatus, recordMarketingOptOut } from "./consent.js";
export { createPgBroadcastStore, staleBroadcastMessages } from "./pg-store.js";

export const BROADCAST_QUEUE_NAME = "broadcasts";
export const BROADCAST_TICK_JOB = "broadcast-tick";
export const BROADCAST_SCHEDULER_ID = "broadcast-tick-every-10s";
export const BROADCAST_TICK_EVERY_MS = 10_000;
/** Recipients materialised per tenant per tick: 50 / 10 s = 300 sends/min per tenant. */
export const BROADCAST_BATCH_SIZE = 50;

export interface BroadcastTickDeps {
  db: Database;
  outboundQueue: Pick<Queue, "add">;
  logger?: Logger;
  now?: () => Date;
  batchSize?: number;
}

export interface BroadcastTickResult {
  tenants: number;
  enqueued: number;
  failedTenants: number;
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * One pass over every active tenant (tenant ids from follow_up_tenant_ids(), migration 0019), each
 * in its own withTenant transaction. Messages are enqueued AFTER commit with jobId = message id
 * (BullMQ dedupes), and lost enqueues are recovered from still-queued broadcast messages.
 */
export async function runBroadcastTick(deps: BroadcastTickDeps): Promise<BroadcastTickResult> {
  const logger = deps.logger ?? silent;
  const rows = await deps.db.execute<{ tenant_id: string }>(sql`select tenant_id from follow_up_tenant_ids()`);
  const res: BroadcastTickResult = { tenants: rows.length, enqueued: 0, failedTenants: 0 };
  for (const { tenant_id: tenantId } of rows) {
    try {
      const now = deps.now?.() ?? new Date();
      const ids = await withTenant(deps.db, tenantId, async (tx) => {
        const pass = await runBroadcastPass(createPgBroadcastStore(tx, tenantId), now, deps.batchSize ?? BROADCAST_BATCH_SIZE);
        const set = new Set(pass.messageIds);
        for (const id of await staleBroadcastMessages(tx, now)) set.add(id);
        return [...set];
      });
      for (const messageId of ids) {
        const data: SendMessageJobData = { tenantId, messageId };
        await deps.outboundQueue.add(SEND_MESSAGE_JOB, data, { ...SEND_MESSAGE_JOB_OPTIONS, jobId: messageId });
        res.enqueued++;
      }
    } catch (err) {
      res.failedTenants++;
      logger.warn(`broadcast tick failed for a tenant (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}

export interface BroadcastWorkerOptions extends BroadcastTickDeps {
  connection: ConnectionOptions;
  queueName?: string;
}

export function createBroadcastWorker(opts: BroadcastWorkerOptions): Worker {
  const { connection, queueName = BROADCAST_QUEUE_NAME, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name !== BROADCAST_TICK_JOB) throw new UnrecoverableError("unknown job name");
      return runBroadcastTick(deps);
    },
    { connection, concurrency: 1 },
  );
}

export async function scheduleBroadcastTick(queue: Pick<Queue, "upsertJobScheduler">, everyMs = BROADCAST_TICK_EVERY_MS): Promise<void> {
  await queue.upsertJobScheduler(
    BROADCAST_SCHEDULER_ID,
    { every: everyMs },
    { name: BROADCAST_TICK_JOB, data: {}, opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } } },
  );
}
