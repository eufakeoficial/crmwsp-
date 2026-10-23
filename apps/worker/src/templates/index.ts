import { TEMPLATE_SYNC_QUEUE_NAME } from "@crmwsp/contracts";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import { runTemplateSyncTick, type TemplateSyncDeps } from "./sync.js";

export * from "./sync.js";

export { TEMPLATE_SYNC_QUEUE_NAME };
export const TEMPLATE_SYNC_TICK_JOB = "template-sync-tick";
export const TEMPLATE_SYNC_SCHEDULER_ID = "template-sync-tick-every-15m";
export const TEMPLATE_SYNC_TICK_EVERY_MS = 15 * 60_000;

export interface TemplateSyncWorkerOptions extends TemplateSyncDeps {
  connection: ConnectionOptions;
  queueName?: string;
}

/** Concurrency 1: Meta review status changes slowly and BSP rate limits are per app. */
export function createTemplateSyncWorker(opts: TemplateSyncWorkerOptions): Worker {
  const { connection, queueName = TEMPLATE_SYNC_QUEUE_NAME, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name !== TEMPLATE_SYNC_TICK_JOB) throw new UnrecoverableError("unknown job name");
      return runTemplateSyncTick(deps);
    },
    { connection, concurrency: 1 },
  );
}

export async function scheduleTemplateSyncTick(
  queue: Pick<Queue, "upsertJobScheduler">,
  everyMs = TEMPLATE_SYNC_TICK_EVERY_MS,
): Promise<void> {
  await queue.upsertJobScheduler(
    TEMPLATE_SYNC_SCHEDULER_ID,
    { every: everyMs },
    { name: TEMPLATE_SYNC_TICK_JOB, data: {}, opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } } },
  );
}
