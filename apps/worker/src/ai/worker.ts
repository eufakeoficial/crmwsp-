import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  AI_QUEUE_NAME,
  AI_TURN_JOB,
  EMBED_SOURCE_JOB,
  EXECUTE_AI_ACTION_JOB,
} from "../queue.js";
import { safeErrorText } from "../processors.js";
import type { AiDeps } from "./common.js";
import { processEmbedSource } from "./embed.js";
import { processExecuteAiAction } from "./execute.js";
import { processAiTurn } from "./turn.js";

export interface AiWorkerOptions extends AiDeps {
  connection: ConnectionOptions;
  queueName?: string;
  concurrency?: number;
}

/**
 * Failure text safe to keep in Redis (`failedReason`) and logs: driver errors embed query
 * parameters (message text, vectors), so only the error class / pg code survives.
 */
function sanitize(err: unknown): Error {
  if (err instanceof UnrecoverableError) return err;
  const name = (err as { name?: unknown } | null)?.name;
  // Provider/crypto errors have fixed messages without request data.
  if (name === "LlmProviderError" || name === "UnsafeBaseUrlError" || name === "DecryptionError") return err as Error;
  if ((err as { provider?: unknown } | null)?.provider === "llm") return err as Error;
  return new Error(safeErrorText(err));
}

export function createAiWorker(opts: AiWorkerOptions): Worker {
  const { connection, queueName = AI_QUEUE_NAME, concurrency = 5, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      try {
        switch (job.name) {
          case EMBED_SOURCE_JOB:
            return await processEmbedSource(deps, job.data);
          case AI_TURN_JOB:
            return await processAiTurn(deps, job.data, {
              attemptsMade: job.attemptsMade,
              maxAttempts: job.opts.attempts ?? 1,
            });
          case EXECUTE_AI_ACTION_JOB:
            return await processExecuteAiAction(deps, job.data);
          default:
            throw new UnrecoverableError("unknown job name");
        }
      } catch (err) {
        throw sanitize(err);
      }
    },
    { connection, concurrency },
  );
}
