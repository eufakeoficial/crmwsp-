import type { Queue } from "bullmq";
import type { OrderSourceKind } from "@crmwsp/ai";
import type { Logger } from "../processors.js";

export const ORDER_EXTRACTION_QUEUE_NAME = "order-extraction";
export const EXTRACT_ORDER_JOB = "extract-order";
export const EXTRACT_ORDER_MAX_ATTEMPTS = 5;

/**
 * Delayed so the AI turn (which transcribes voice notes once and persists the transcript) usually
 * runs first: this job reuses that transcript instead of paying for a second transcription.
 */
export const EXTRACT_ORDER_JOB_OPTIONS = {
  delay: 10_000,
  attempts: EXTRACT_ORDER_MAX_ATTEMPTS,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

export const extractOrderJobId = (messageId: string): string => `extract-order-${messageId}`;

export interface ExtractOrderJobData {
  tenantId: string;
  conversationId: string;
  messageId: string;
}

/** Which F4 source a media mime type is, or null when it cannot carry an order. */
export function orderSourceOf(mimeType: string | null | undefined): OrderSourceKind | null {
  const m = (mimeType ?? "").toLowerCase().split(";")[0]!.trim();
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  return null;
}

/**
 * Ingest hook: schedules order detection for an inbound media message. Best effort: the message is
 * already committed, so an enqueue failure only loses the detection (logged without data).
 */
export async function enqueueOrderExtraction(
  queue: Pick<Queue, "add"> | undefined,
  data: ExtractOrderJobData,
  mimeType: string | null | undefined,
  logger: Logger,
): Promise<boolean> {
  if (!queue || orderSourceOf(mimeType) === null) return false;
  try {
    await queue.add(EXTRACT_ORDER_JOB, data, { ...EXTRACT_ORDER_JOB_OPTIONS, jobId: extractOrderJobId(data.messageId) });
    return true;
  } catch (err) {
    logger.warn(`could not enqueue extract-order (${err instanceof Error ? err.name : "unknown"})`);
    return false;
  }
}
