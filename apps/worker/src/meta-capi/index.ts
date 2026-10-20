import { UnrecoverableError, Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import { runCapiTick, type CapiTickDeps } from "./tick.js";

export * from "./client.js";
export * from "./tick.js";

export const CAPI_QUEUE_NAME = "meta-capi";
export const CAPI_TICK_JOB = "capi-tick";
export const CAPI_SCHEDULER_ID = "capi-tick-every-minute";
export const CAPI_TICK_EVERY_MS = 60_000;

export interface CapiWorkerOptions extends CapiTickDeps {
  connection: ConnectionOptions;
  queueName?: string;
}

/** Concurrency 1: one tick at a time per process (rows are also locked SKIP LOCKED). */
export function createCapiWorker(opts: CapiWorkerOptions): Worker {
  const { connection, queueName = CAPI_QUEUE_NAME, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name !== CAPI_TICK_JOB) throw new UnrecoverableError("unknown job name");
      return runCapiTick(deps);
    },
    { connection, concurrency: 1 },
  );
}

export async function scheduleCapiTick(queue: Pick<Queue, "upsertJobScheduler">, everyMs = CAPI_TICK_EVERY_MS): Promise<void> {
  await queue.upsertJobScheduler(
    CAPI_SCHEDULER_ID,
    { every: everyMs },
    { name: CAPI_TICK_JOB, data: {}, opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } } },
  );
}
