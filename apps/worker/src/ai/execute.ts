import { aiActions, withTenant } from "@crmwsp/db";
import { UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";
import { runAction } from "./actions.js";
import { assertIds, type AiDeps } from "./common.js";

export type ExecuteAiActionResult =
  | { outcome: "skipped"; reason: "not-approved" }
  | { outcome: "executed" | "approved" | "failed" };

/**
 * Executes an action a human approved in the UI. Idempotent: the row is locked (FOR UPDATE) and
 * anything that is not `approved` is left untouched, so a replay never applies it twice.
 */
export async function processExecuteAiAction(deps: AiDeps, data: unknown): Promise<ExecuteAiActionResult> {
  const { tenantId, actionId } = assertIds(data, ["tenantId", "actionId"]);
  const now = (deps.now ?? (() => new Date()))();
  return withTenant(deps.db, tenantId, async (tx): Promise<ExecuteAiActionResult> => {
    const [row] = await tx.select().from(aiActions).where(eq(aiActions.id, actionId)).limit(1).for("update");
    if (!row) throw new UnrecoverableError("ai action not found");
    if (row.status !== "approved") return { outcome: "skipped", reason: "not-approved" };
    const outcome = await runAction(tx, row, now);
    await tx
      .update(aiActions)
      .set({
        status: outcome.status,
        result: outcome.result,
        ...(outcome.status === "executed" || outcome.status === "failed" ? { executedAt: now } : {}),
      })
      .where(eq(aiActions.id, actionId));
    return { outcome: outcome.status };
  });
}
