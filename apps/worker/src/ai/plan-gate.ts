import { applyTenantAccess, checkLimit, resolveEffectivePlan } from "@crmwsp/billing";
import type { PlanUsageSnapshot, Transaction } from "@crmwsp/db";
import { isSubscriptionRestricted } from "../subscription-billing/index.js";

/**
 * Plan gate for the monthly `ai_messages` cap. With the tenant's own provider key (BYOK, ADR 0008)
 * there is no cap, but a restricted subscription (ADR 0013/0015) still blocks the AI. Without an
 * own key the plan cap applies as before.
 */
export async function aiMessagesAllowed(tx: Transaction, usage: PlanUsageSnapshot, conn: { apiKeyEncrypted: unknown }): Promise<boolean> {
  const plan = resolveEffectivePlan(usage.plan, usage.limitsOverride);
  if (conn.apiKeyEncrypted == null) return checkLimit(plan, "ai_messages", usage.aiMessages, 1).allowed;
  const restricted = await isSubscriptionRestricted(tx);
  const effective = applyTenantAccess(plan, restricted ? "restricted" : "active", { ownAiKey: true });
  return checkLimit(effective, "ai_messages", usage.aiMessages, 1).allowed;
}
