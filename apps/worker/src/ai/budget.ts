import { auditEvents, withTenant, type LlmConnection, type Transaction } from "@crmwsp/db";
import { and, eq, sql } from "drizzle-orm";
import { publishEvents, silent, type AiDeps } from "./common.js";

/**
 * Units: `usage_ledger.cost_minor` stores what `estimateCost` returns (USD micro-cents,
 * 1e-8 USD, flagged with `meta.unit = "usd_microcents"`) because per-call costs are far below one
 * cent. `llm_connections.monthly_budget_minor` is in minor units (cents) of `budget_currency`, so a
 * USD budget is compared as `budget_cents * 1_000_000` micro-cents (1 cent = 1e-2 USD = 1e6 * 1e-8).
 * Only the AI kinds (`llm_tokens`, `embedding_tokens`, `transcription_seconds`) in USD count.
 *
 * Non-USD budgets: there is no FX source yet and prices are estimates, so the worker is
 * conservative the other way round: it does NOT stop the AI for budget (no conversion = no
 * comparison) and reports `currencyMismatch` so callers log a warning. Debt: add an FX source
 * (or force USD budgets in the API) before enforcing non-USD budgets.
 */
const MICRO_PER_MINOR = 1_000_000n;
const BUDGET_CURRENCY = "USD";

export interface BudgetState {
  exceeded: boolean;
  /** Spend reached 80 % of the budget. */
  warn: boolean;
  /** Budget set in a currency other than USD: not enforced (see above). */
  currencyMismatch?: boolean;
}

/** Month spend vs. budget, read with `tenant_monthly_spend` (RLS-scoped). */
export async function readBudget(
  tx: Transaction,
  conn: Pick<LlmConnection, "monthlyBudgetMinor" | "budgetCurrency">,
): Promise<BudgetState> {
  if (conn.monthlyBudgetMinor === null) return { exceeded: false, warn: false };
  if ((conn.budgetCurrency ?? "").trim().toUpperCase() !== BUDGET_CURRENCY) {
    return { exceeded: false, warn: false, currencyMismatch: true };
  }
  const rows = await tx.execute<{ cost_minor: string | null }>(
    sql`select cost_minor from tenant_monthly_spend(now()) where currency = ${BUDGET_CURRENCY} and kind in ('llm_tokens', 'embedding_tokens', 'transcription_seconds')`,
  );
  let spentMicro = 0n;
  for (const r of rows) spentMicro += BigInt(String(r.cost_minor ?? "0").split(".")[0] || "0");
  const budgetMicro = conn.monthlyBudgetMinor * MICRO_PER_MINOR;
  return { exceeded: spentMicro >= budgetMicro, warn: spentMicro * 100n >= budgetMicro * 80n };
}

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
