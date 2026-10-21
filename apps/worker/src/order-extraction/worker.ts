import { UnrecoverableError, Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import { assertIds, publishEvents, silent, type AiDeps } from "../ai/common.js";
import { safeErrorText } from "../processors.js";
import { AI_JOB_OPTIONS, AI_TURN_JOB, SEND_MESSAGE_JOB, SEND_MESSAGE_JOB_OPTIONS, aiTurnJobId, type AiTurnJobData } from "../queue.js";
import { handleOrderExtraction, type OrderFlowResult } from "./flow.js";
import { pgOrderFlowPorts, type OrderExtractionDeps } from "./pg.js";
import { EXTRACT_ORDER_JOB, EXTRACT_ORDER_MAX_ATTEMPTS, ORDER_EXTRACTION_QUEUE_NAME, type ExtractOrderJobData } from "./queue.js";

export interface OrderExtractionWorkerDeps extends OrderExtractionDeps, Pick<AiDeps, "publisher"> {
  outboundQueue: Pick<Queue, "add">;
  /** `ai` queue: the normal AI turn is scheduled from here when the media turned out not to be an order. */
  aiQueue: Pick<Queue, "add">;
}

/** Hands the message back to the normal AI turn (same job id as ingest would use: deduplicated). */
export async function scheduleAiTurn(deps: Pick<OrderExtractionWorkerDeps, "aiQueue">, job: ExtractOrderJobData): Promise<void> {
  const data: AiTurnJobData = { tenantId: job.tenantId, conversationId: job.conversationId, triggerMessageId: job.messageId };
  await deps.aiQueue.add(AI_TURN_JOB, data, { ...AI_JOB_OPTIONS, jobId: aiTurnJobId(job.messageId) });
}

/**
 * One `extract-order` job. Exactly one customer reply per inbound media message: ingest schedules
 * this job INSTEAD of the AI turn for order candidates; when an order is found its summary is the
 * reply, otherwise (chit-chat, no items, model failure, receipt...) the normal AI turn is scheduled.
 */
export async function processExtractOrder(
  deps: OrderExtractionWorkerDeps,
  data: unknown,
  attempt: { attemptsMade: number; maxAttempts: number },
): Promise<OrderFlowResult> {
  const job = assertIds(data, ["tenantId", "conversationId", "messageId"]) as ExtractOrderJobData;
  const logger = deps.logger ?? silent;
  let out: OrderFlowResult;
  try {
    out = await handleOrderExtraction(pgOrderFlowPorts(deps, job, { logger }));
  } catch (err) {
    // Last attempt failed: never leave the customer without an answer.
    if (attempt.attemptsMade + 1 >= attempt.maxAttempts) await scheduleAiTurn(deps, job);
    throw err;
  }
  if (out.outcome === "created" && out.enqueueMessageId) {
    await deps.outboundQueue.add(
      SEND_MESSAGE_JOB,
      { tenantId: job.tenantId, messageId: out.enqueueMessageId },
      { ...SEND_MESSAGE_JOB_OPTIONS, jobId: out.enqueueMessageId },
    );
  }
  if (out.outcome === "skipped" && out.aiTurn) await scheduleAiTurn(deps, job);
  await publishEvents(deps as unknown as AiDeps, job.tenantId, out.events);
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
        if (err instanceof UnrecoverableError) throw err;
        const name = (err as { name?: unknown } | null)?.name;
        if (name === "LlmProviderError" || name === "DecryptionError" || name === "UnsafeBaseUrlError") throw err as Error;
        throw new Error(safeErrorText(err));
      }
    },
    { connection, concurrency },
  );
}
