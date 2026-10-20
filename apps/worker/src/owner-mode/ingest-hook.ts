import type { Transaction } from "@crmwsp/db";
import type { Queue } from "bullmq";
import { OWNER_COMMAND_JOB, OWNER_COMMAND_JOB_OPTIONS, ownerCommandJobId, type OwnerCommandJobData } from "./queue.js";
import { routeOwnerInbound, type OwnerInbound, type OwnerRouteResult } from "./routing.js";

/* Thin seam used by processors.ts (kept here so the ingest pipeline only gains two calls). */

export function ownerModeHook(tx: Transaction, m: OwnerInbound): Promise<OwnerRouteResult | null> {
  return routeOwnerInbound(tx, m);
}

export async function enqueueOwnerCommand(
  queue: Pick<Queue, "add"> | undefined,
  tenantId: string,
  commandId: string,
  logger: { warn(msg: string): void },
): Promise<void> {
  if (!queue) return;
  const data: OwnerCommandJobData = { tenantId, commandId };
  try {
    await queue.add(OWNER_COMMAND_JOB, data, { ...OWNER_COMMAND_JOB_OPTIONS, jobId: ownerCommandJobId(commandId) });
  } catch (err) {
    // The command row is committed with status `received`; the owner gets no answer and can retry.
    logger.warn(`could not enqueue owner-command (${err instanceof Error ? err.name : "unknown"})`);
  }
}
