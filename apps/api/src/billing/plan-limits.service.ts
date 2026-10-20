import { Inject, Injectable } from "@nestjs/common";
import { checkLimit, isMonthlyLimit, resolveEffectivePlan, summarizeUsage, type LimitKey, type MonthlyLimitKey } from "@crmwsp/billing";
import { PlanLimitExceededError, type BillingPlanResponse } from "@crmwsp/contracts";
import { consumeUsage, readPlanUsage, withTenant, type DbHandle, type PlanUsageSnapshot, type Transaction } from "@crmwsp/db";
import { DB_HANDLE } from "../common/http.js";

function usedByKey(s: PlanUsageSnapshot): Record<LimitKey, number> {
  return {
    ai_messages: s.aiMessages,
    broadcast_sends: s.broadcastSends,
    contacts: s.contacts,
    seats: s.seats,
    whatsapp_numbers: s.whatsappNumbers,
  };
}

/**
 * Plan limits for other modules (broadcasts, contacts import, invitations...). All reads run
 * under the tenant (RLS). Pass `tx` to check inside an existing `withTenant` transaction.
 * Subscription charging is out of scope: the plan is assigned by the platform, never by tenants.
 */
@Injectable()
export class PlanLimitsService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  private run<T>(tenantId: string, tx: Transaction | undefined, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : withTenant(this.handle.db, tenantId, fn);
  }

  /** Throws `PlanLimitExceededError` (402) if `amount` more units would exceed the plan. Consumes nothing. */
  async assert(tenantId: string, key: LimitKey, amount = 1, tx?: Transaction): Promise<void> {
    const snapshot = await this.run(tenantId, tx, readPlanUsage);
    const plan = resolveEffectivePlan(snapshot.plan, snapshot.limitsOverride);
    const result = checkLimit(plan, key, usedByKey(snapshot)[key], amount);
    if (!result.allowed) {
      throw new PlanLimitExceededError(`Plan ${plan.name}: ${key} ${result.reason}`, {
        details: { plan: plan.id, key, limit: result.limit, used: result.used, reason: result.reason },
      });
    }
  }

  /**
   * Atomically books `amount` units of a monthly limit, refusing (402, nothing written) when it
   * would exceed the plan. Use for sends that must not race past the cap (e.g. broadcasts).
   */
  async consume(tenantId: string, key: MonthlyLimitKey, amount: number, tx?: Transaction): Promise<number> {
    return this.run(tenantId, tx, async (t) => {
      const usage = await readPlanUsage(t);
      const plan = resolveEffectivePlan(usage.plan, usage.limitsOverride);
      const limit = plan.limits[key];
      const total = await consumeUsage(t, tenantId, key, amount, limit);
      if (total === null) {
        throw new PlanLimitExceededError(`Plan ${plan.name}: ${key} limit_reached`, {
          details: { plan: plan.id, key, limit, reason: limit === 0 ? "not_included" : "limit_reached" },
        });
      }
      return total;
    });
  }

  async snapshot(tx: Transaction): Promise<BillingPlanResponse> {
    const s = await readPlanUsage(tx);
    const plan = resolveEffectivePlan(s.plan, s.limitsOverride);
    const items = summarizeUsage(plan, usedByKey(s));
    return {
      plan: { id: plan.id, name: plan.name, priceMonthlyUsd: plan.priceMonthlyUsd, priceAnnualUsd: plan.priceAnnualUsd },
      period: s.period,
      usage: items.map((i) => ({ ...i, monthly: isMonthlyLimit(i.key) })),
      billingProvider: "none",
    };
  }
}
