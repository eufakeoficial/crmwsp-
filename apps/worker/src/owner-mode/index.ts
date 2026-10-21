import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from "bullmq";
import { processOwnerCommand, type OwnerModeDeps } from "./handler.js";
import { OWNER_COMMAND_JOB, OWNER_MODE_QUEUE_NAME } from "./queue.js";

export * from "./queue.js";
export * from "./routing.js";
export * from "./ports.js";
export * from "./handler.js";

export interface OwnerModeWorkerOptions extends OwnerModeDeps {
  connection: ConnectionOptions;
  concurrency?: number;
}

export function createOwnerModeWorker(opts: OwnerModeWorkerOptions): Worker {
  const { connection, concurrency = 3, ...deps } = opts;
  return new Worker(
    OWNER_MODE_QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== OWNER_COMMAND_JOB) throw new UnrecoverableError("unknown job name");
      return processOwnerCommand(deps, job.data);
    },
    { connection, concurrency },
  );
}
