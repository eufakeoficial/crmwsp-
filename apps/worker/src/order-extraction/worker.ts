import { UnrecoverableError, Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import { assertIds, publishEvents, silent, type AiDeps } from "../ai/common.js";
import { safeErrorText } from "../processors.js";
import { SEND_MESSAGE_JOB, SEND_MESSAGE_JOB_OPTIONS } from "../queue.js";
import { TranscriptPendingError, handleOrderExtraction, type OrderFlowResult } from "./flow.js";
import { pgOrderFlowPorts, type OrderExtractionDeps } from "./pg.js";
import { EXTRACT_ORDER_JOB, EXTRACT_ORDER_MAX_ATTEMPTS, ORDER_EXTRACTION_QUEUE_NAME, type ExtractOrderJobData } from "./queue.js";

export interface OrderExtractionWorkerDeps extends OrderExtractionDeps, Pick<AiDeps, "publisher"> {
  outboundQueue: Pick<Queue, "add">;
}

/** One `extract-order` job: detection, matching and the quote DRAFT; then the reply is handed to outbound. */
export async function processExtractOrder(
  deps: OrderExtractionWorkerDeps,
  data: unknown,
  attempt: { attemptsMade: number; maxAttempts: number },
): Promise<OrderFlowResult> {
  const job = assertIds(data, ["tenantId", "conversationId", "messageId"]) as ExtractOrderJobData;
  const logger = deps.logger ?? silent;
  const out = await handleOrderExtraction(
    pgOrderFlowPorts(deps, job, { lastAttempt: attempt.attemptsMade + 1 >= attempt.maxAttempts, logger }),
  );
  if (out.outcome === "created" && out.enqueueMessageId) {
    await deps.outboundQueue.add(
      SEND_MESSAGE_JOB,
      { tenantId: job.tenantId, messageId: out.enqueueMessageId },
      { ...SEND_MESSAGE_JOB_OPTIONS, jobId: out.enqueueMessageId },
    );
  }
  await publishEvents(deps as AiDeps, job.tenantId, out.events);
  return out;
}

export interface OrderExtractionWorkerOptions extends OrderExtractionWorkerDeps {
  connection: ConnectionOptions;
  concurrency?: number;
}

export function createOrderExtractionWorker(opts: OrderExtractionWorkerOptions): Worker {
  const { connection, concurrency = 2, ...deps } = opts;
  return new Worker(
    ORDER_EXTRACTION_QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== EXTRACT_ORDER_JOB) throw new UnrecoverableError("unknown job name");
      try {
        return await processExtractOrder(deps, job.data, {
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? EXTRACT_ORDER_MAX_ATTEMPTS,
        });
      } catch (err) {
        if (err instanceof UnrecoverableError || err instanceof TranscriptPendingError) throw err;
        const name = (err as { name?: unknown } | null)?.name;
        if (name === "LlmProviderError" || name === "DecryptionError" || name === "UnsafeBaseUrlError") throw err as Error;
        throw new Error(safeErrorText(err));
      }
    },
    { connection, concurrency },
  );
}
