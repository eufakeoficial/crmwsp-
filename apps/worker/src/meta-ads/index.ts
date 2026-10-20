import { META_ADS_QUEUE_NAME, META_ADS_SYNC_TENANT_JOB } from "@crmwsp/contracts";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import { runMetaAdsTick, syncMetaAdsTenant, type MetaAdsSyncDeps } from "./sync.js";

export * from "./client.js";
export * from "./sync.js";

export { META_ADS_QUEUE_NAME, META_ADS_SYNC_TENANT_JOB };
export const META_ADS_TICK_JOB = "meta-ads-tick";
export const META_ADS_SCHEDULER_ID = "meta-ads-tick-every-6h";
export const META_ADS_TICK_EVERY_MS = 6 * 3600_000;

export interface MetaAdsWorkerOptions extends MetaAdsSyncDeps {
  connection: ConnectionOptions;
  queueName?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Concurrency 1: Meta rate limits are per app/account; one sync at a time per process. */
export function createMetaAdsWorker(opts: MetaAdsWorkerOptions): Worker {
  const { connection, queueName = META_ADS_QUEUE_NAME, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name === META_ADS_TICK_JOB) return runMetaAdsTick(deps);
      if (job.name === META_ADS_SYNC_TENANT_JOB) {
        const tenantId = (job.data as { tenantId?: unknown } | undefined)?.tenantId;
        if (typeof tenantId !== "string" || !UUID.test(tenantId)) throw new UnrecoverableError("invalid tenant id");
        return syncMetaAdsTenant(deps, tenantId);
      }
      throw new UnrecoverableError("unknown job name");
    },
    { connection, concurrency: 1 },
  );
}

export async function scheduleMetaAdsTick(queue: Pick<Queue, "upsertJobScheduler">, everyMs = META_ADS_TICK_EVERY_MS): Promise<void> {
  await queue.upsertJobScheduler(
    META_ADS_SCHEDULER_ID,
    { every: everyMs },
    { name: META_ADS_TICK_JOB, data: {}, opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } } },
  );
}
