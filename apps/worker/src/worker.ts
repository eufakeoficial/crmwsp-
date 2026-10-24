import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from "bullmq";
import { processIngestAccount } from "./channel-quality.js";
import {
  processIngestMessage,
  processIngestStatus,
  recordFailure,
  type ProcessorDeps,
} from "./processors.js";
import { INBOUND_QUEUE_NAME, INGEST_ACCOUNT_JOB, INGEST_MESSAGE_JOB, INGEST_STATUS_JOB } from "./queue.js";

export interface InboundWorkerOptions extends ProcessorDeps {
  connection: ConnectionOptions;
  queueName?: string;
  concurrency?: number;
}

export function createInboundWorker(opts: InboundWorkerOptions): Worker {
  const { connection, queueName = INBOUND_QUEUE_NAME, concurrency = 5, ...deps } = opts;
  const log = deps.logger;
  return new Worker(
    queueName,
    async (job: Job) => {
      try {
        switch (job.name) {
          case INGEST_MESSAGE_JOB:
            return await processIngestMessage(deps, job.data);
          case INGEST_STATUS_JOB:
            return await processIngestStatus(deps, job.data);
          case INGEST_ACCOUNT_JOB:
            return await processIngestAccount(deps, job.data);
          default:
            throw new UnrecoverableError("unknown job name");
        }
      } catch (err) {
        try {
          await recordFailure(deps.db, job.data, err);
        } catch {
          log?.error(`could not record failure for job ${job.id ?? "?"}`);
        }
        throw err;
      }
    },
    { connection, concurrency },
  );
}
