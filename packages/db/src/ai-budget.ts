import { sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import type { LlmConnection } from "./schema/index.js";

/**
 * Monthly AI budget (ADR 0008), shared by the worker turn and the API simulator.
 * Units: `usage_ledger.cost_minor` stores USD micro-cents (1e-8 USD) for AI kinds;
 * `llm_connections.monthly_budget_minor` is in cents of `budget_currency`, so a USD budget is
 * compared as `budget_cents * 1_000_000` micro-cents. Only AI kinds in USD count (simulations
 * included: they spend real tokens).
 *
 * Non-USD budgets are NOT enforced (no FX source yet) and report `currencyMismatch`.
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
    sql`select cost_minor from tenant_monthly_spend(now()) where currency = ${BUDGET_CURRENCY} and kind in ('llm_tokens', 'embedding_tokens', 'transcription_seconds', 'simulation')`,
  );
  let spentMicro = 0n;
  for (const r of rows) spentMicro += BigInt(String(r.cost_minor ?? "0").split(".")[0] || "0");
  const budgetMicro = conn.monthlyBudgetMinor * MICRO_PER_MINOR;
  return { exceeded: spentMicro >= budgetMicro, warn: spentMicro * 100n >= budgetMicro * 80n };
}
