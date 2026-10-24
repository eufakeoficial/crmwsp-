import { Inject, Injectable, Logger } from "@nestjs/common";
import { trialIdentityHash } from "@crmwsp/billing/trial-identity";
import {
  SUBSCRIPTION_GRACE_DAYS,
  applyTenantAccess,
  checkLimit,
  daysLeft,
  isMonthlyLimit,
  resolveEffectivePlan,
  summarizeUsage,
  tenantAccess,
  type LimitKey,
  type MonthlyLimitKey,
  type PlanDefinition,
  type TenantAccess,
  type TrialLifecycle,
} from "@crmwsp/billing";
import { PlanLimitExceededError, SetupRequiredError, type BillingPlanResponse } from "@crmwsp/contracts";
import { consumeUsage, readPlanUsage, sql, withTenant, type DbHandle, type PlanUsageSnapshot, type Transaction } from "@crmwsp/db";
import { DB_HANDLE } from "../common/http.js";

/** Last paid day of the current tenant (`tenant_subscription_paid_until`, 0061); null = never paid. */
export async function readPaidUntil(tx: Transaction): Promise<string | null> {
  const [row] = await tx.execute<{ d: string | null }>(sql`select public.tenant_subscription_paid_until()::text as d`);
  return row?.d ?? null;
}

function lifecycleOf(s: PlanUsageSnapshot): TrialLifecycle {
  return {
    setupEndsAt: s.setupEndsAt ?? null,
    trialStartedAt: s.trialStartedAt ?? null,
    trialEndsAt: s.trialEndsAt ?? null,
    trialDeniedAt: s.trialDeniedAt ?? null,
  };
}

/** Access of the tenant: subscription rules plus the trial lifecycle of new tenants (ADR 0015). */
function accessOf(s: PlanUsageSnapshot, paidUntil: string | null): TenantAccess {
  return tenantAccess(paidUntil, lifecycleOf(s), new Date());
}

/**
 * Plan + admin overrides, then capped by the access state (setup caps AI, restricted = nothing).
 * `ownAiKey` (BYOK) lifts the monthly `ai_messages` cap; setup/restricted still block the AI.
 */
function effectivePlan(s: PlanUsageSnapshot, paidUntil: string | null, ownAiKey = false): PlanDefinition {
  return applyTenantAccess(resolveEffectivePlan(s.plan, s.limitsOverride), accessOf(s, paidUntil), { ownAiKey });
}

/** True when the active LLM connection of the current tenant holds its own provider key (BYOK, ADR 0008). */
async function readOwnAiKey(tx: Transaction): Promise<boolean> {
  const [row] = await tx.execute<{ own: boolean }>(
    sql`select exists (select 1 from llm_connections where is_active and api_key_encrypted is not null) as own`,
  );
  return row?.own === true;
}

export type TrialStartOutcome = "started" | "denied" | "ineligible";

/**
 * `type:hash` identities of a channel for `trial_claims` (phone only: neither BSP adapter exposes
 * a WABA id today). Empty when TRIAL_IDENTITY_SECRET is unset. Hashes are hex, so they are safe
 * to inline in the array literal.
 */
export function trialIdentitiesOf(phoneE164: string, secret = process.env["TRIAL_IDENTITY_SECRET"] ?? ""): string[] {
  if (!secret) return [];
  return [`phone:${trialIdentityHash(secret, "phone", phoneE164)}`];
}

/** Limits that cannot be used while the tenant is in setup (no WhatsApp channel yet). */
const SETUP_BLOCKED: ReadonlySet<LimitKey> = new Set<LimitKey>(["contacts", "seats", "broadcast_sends"]);

function setupRequired(): SetupRequiredError {
  return new SetupRequiredError("Connect your WhatsApp channel to start your trial", { details: { reason: "setup_required" } });
}

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
  private readonly logger = new Logger(PlanLimitsService.name);

  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  private run<T>(tenantId: string, tx: Transaction | undefined, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : withTenant(this.handle.db, tenantId, fn);
  }

  /**
   * Serializes check-then-insert of one limit for a tenant inside `tx` (transaction-scoped
   * advisory lock), so two concurrent requests cannot both pass `assert` at the cap.
   */
  async lock(tx: Transaction, tenantId: string, key: LimitKey): Promise<void> {
    await tx.execute(sql`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`plan-limit:${key}:${tenantId}`}, 0))`);
  }

  /** Throws `PlanLimitExceededError` (402) if `amount` more units would exceed the plan. Consumes nothing. */
  async assert(tenantId: string, key: LimitKey, amount = 1, tx?: Transaction): Promise<void> {
    const { snapshot, paidUntil, ownAiKey } = await this.run(tenantId, tx, async (t) => ({
      snapshot: await readPlanUsage(t),
      paidUntil: await readPaidUntil(t),
      ownAiKey: key === "ai_messages" && (await readOwnAiKey(t)),
    }));
    if (SETUP_BLOCKED.has(key) && accessOf(snapshot, paidUntil) === "setup") throw setupRequired();
    const plan = effectivePlan(snapshot, paidUntil, ownAiKey);
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
      const paidUntil = await readPaidUntil(t);
      if (SETUP_BLOCKED.has(key) && accessOf(usage, paidUntil) === "setup") throw setupRequired();
      const plan = effectivePlan(usage, paidUntil, key === "ai_messages" && (await readOwnAiKey(t)));
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

  /**
   * Throws `SetupRequiredError` (402 `SETUP_REQUIRED`) while the tenant is in setup, and
   * `PlanLimitExceededError` (402, reason `subscription_restricted`) when the subscription or the
   * trial lapsed past grace (ADR 0013/0015). Used for outbound messages and by `ActivationGuard`.
   */
  async assertSubscriptionActive(tenantId: string, tx?: Transaction): Promise<void> {
    const { snapshot, paidUntil } = await this.run(tenantId, tx, async (t) => ({ snapshot: await readPlanUsage(t), paidUntil: await readPaidUntil(t) }));
    const access = accessOf(snapshot, paidUntil);
    if (access === "setup") throw setupRequired();
    if (access === "payment_required") {
      throw new PlanLimitExceededError("This WhatsApp number already used its free trial: activate a plan to continue", {
        details: { key: "subscription", reason: "trial_already_used" },
      });
    }
    if (access === "restricted") {
      throw new PlanLimitExceededError("Subscription expired: outbound messages are disabled until it is renewed", {
        details: { key: "subscription", reason: "subscription_restricted", paidUntil },
      });
    }
  }

  /** Throws `SetupRequiredError` (402) while the tenant is in setup; nothing else (ADR 0015). */
  async assertNotInSetup(tenantId: string, tx?: Transaction): Promise<void> {
    const { snapshot, paidUntil } = await this.run(tenantId, tx, async (t) => ({ snapshot: await readPlanUsage(t), paidUntil: await readPaidUntil(t) }));
    if (accessOf(snapshot, paidUntil) === "setup") throw setupRequired();
  }

  /**
   * Called inside the transaction that made a channel active (ADR 0015): records the channel's
   * phone in `trial_claims` (HMAC, one free trial per number for life) and, when the tenant is in
   * setup, starts the 7-day trial, or denies it when another tenant already claimed the number.
   * Without TRIAL_IDENTITY_SECRET no identity is claimed (logged): the trial starts unchecked and
   * the worker backfill claims the number once the secret is configured.
   */
  async startTrialIfEligible(tx: Transaction, channel: { id: string; phoneE164: string }): Promise<TrialStartOutcome> {
    const identities = trialIdentitiesOf(channel.phoneE164);
    if (identities.length === 0) this.logger.warn("TRIAL_IDENTITY_SECRET is not set: trial started without the one-trial-per-number check");
    const [row] = await tx.execute<{ outcome: TrialStartOutcome }>(
      sql`select public.tenant_trial_start(${channel.id}::uuid, ${sql.raw(`ARRAY[${identities.map((i) => `'${i}'`).join(",")}]::text[]`)}) as outcome`,
    );
    return row?.outcome ?? "ineligible";
  }

  async snapshot(tx: Transaction): Promise<BillingPlanResponse> {
    const s = await readPlanUsage(tx);
    const paidUntil = await readPaidUntil(tx);
    const plan = effectivePlan(s, paidUntil, await readOwnAiKey(tx));
    const access = accessOf(s, paidUntil);
    const now = new Date();
    const items = summarizeUsage(plan, usedByKey(s));
    return {
      plan: { id: plan.id, name: plan.name, priceMonthlyUsd: plan.priceMonthlyUsd, priceAnnualUsd: plan.priceAnnualUsd },
      period: s.period,
      usage: items.map((i) => ({ ...i, monthly: isMonthlyLimit(i.key) })),
      billingProvider: process.env["NOWPAYMENTS_API_KEY"] ? "nowpayments" : "none",
      subscription: {
        access,
        paidUntil,
        graceDays: SUBSCRIPTION_GRACE_DAYS,
        setupEndsAt: s.setupEndsAt?.toISOString() ?? null,
        trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
        daysLeft:
          access === "setup" && s.setupEndsAt ? daysLeft(s.setupEndsAt, now) : access === "trial" && s.trialEndsAt ? daysLeft(s.trialEndsAt, now) : null,
      },
    };
  }
}
