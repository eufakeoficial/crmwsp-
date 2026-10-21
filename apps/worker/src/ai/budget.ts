import { auditEvents, readBudget, withTenant, type BudgetState, type LlmConnection } from "@crmwsp/db";
import { and, eq, sql } from "drizzle-orm";
import { publishEvents, silent, type AiDeps } from "./common.js";

/** Shared with the API simulator (packages/db/src/ai-budget.ts). */
export { readBudget, type BudgetState };

/**
 * Emits `ai.budget_warning` at most once per tenant-month. The marker is an `audit_events` row
 * (action `ai.budget_warning`, diff.month) checked under a per-tenant-month advisory lock, so two
 * concurrent turns cannot both publish it. Runs in its own short transaction (never inside the
 * per-conversation turn transactions).
 */
export async function maybeWarnBudget(deps: AiDeps, tenantId: string, conn: LlmConnection): Promise<boolean> {
  if (conn.monthlyBudgetMinor === null) return false;
  try {
    const month = await withTenant(deps.db, tenantId, async (tx) => {
      const state = await readBudget(tx, conn);
      if (!state.warn) return null;
      const [m] = await tx.execute<{ m: string }>(sql`
        select to_char(now() at time zone coalesce(
          (select timezone from tenants where id = nullif(current_setting('app.tenant_id', true), '')::uuid), 'UTC'), 'YYYY-MM') as m`);
      const key = m?.m;
      if (!key) return null;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai-budget-warning:${tenantId}:${key}`}, 0))`);
      const [marker] = await tx
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "ai.budget_warning"),
            eq(auditEvents.entityId, conn.id),
            sql`${auditEvents.diff}->>'month' = ${key}`,
          ),
        )
        .limit(1);
      if (marker) return null;
      await tx.insert(auditEvents).values({
        tenantId,
        actorType: "system",
        entity: "llm_connection",
        entityId: conn.id,
        action: "ai.budget_warning",
        diff: { month: key, thresholdPercent: 80 },
      });
      return key;
    });
    if (!month) return false;
    await publishEvents(deps, tenantId, [{ type: "ai.budget_warning", connectionId: conn.id, month }]);
    return true;
  } catch (err) {
    (deps.logger ?? silent).warn(`budget warning check failed (${err instanceof Error ? err.name : "unknown"})`);
    return false;
  }
}
