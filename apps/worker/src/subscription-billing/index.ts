import { decideSettlement, subscriptionAccess, type LocalCharge } from "@crmwsp/billing";
import { SETTLE_SUBSCRIPTION_EVENT_JOB, SUBSCRIPTION_BILLING_QUEUE_NAME } from "@crmwsp/contracts";
import { eq, isUuid, sql, subscriptionCharges, withTenant, type Database, type Transaction } from "@crmwsp/db";
import { PaymentProviderError, parseNowPaymentsPayment, type NowPaymentsPayment, type NowPaymentsProvider } from "@crmwsp/payments";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import type { Logger } from "../processors.js";

/**
 * SaaS subscription settlement (NOWPayments, ADR 0013). Two jobs on one queue:
 *  - settle-subscription-event: applies one persisted, verified event (IPN or reconciliation);
 *  - subscription-reconcile-tick: polls GET /payment/{id} for pending charges older than a few
 *    minutes and feeds the SAME settlement path (dedupe prefix `reconcile:`).
 * Settlement is idempotent: replays and reordered events never double-grant a period.
 */

export { SETTLE_SUBSCRIPTION_EVENT_JOB, SUBSCRIPTION_BILLING_QUEUE_NAME };
export const SUBSCRIPTION_RECONCILE_TICK_JOB = "subscription-reconcile-tick";
export const SUBSCRIPTION_RECONCILE_SCHEDULER_ID = "subscription-reconcile-every-5-minutes";
export const SUBSCRIPTION_RECONCILE_EVERY_MS = 5 * 60_000;
/** Only charges at least this old are polled (IPNs usually arrive first). */
export const SUBSCRIPTION_RECONCILE_MIN_AGE_S = 5 * 60;

export interface SubscriptionBillingDeps {
  db: Database;
  /** Null when NOWPAYMENTS_API_KEY is unset: IPN settlement still works, reconciliation is off. */
  provider: Pick<NowPaymentsProvider, "getPayment"> | null;
  logger?: Logger;
}

export type SettleOutcome =
  | "paid"
  | "pending"
  | "failed"
  | "expired"
  | "refunded"
  | "ignored"
  | "underpaid"
  | "payin_hash_conflict"
  | "mismatch"
  | "not_found";

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** True when the current tenant's paid period ended more than the grace days ago. */
export async function isSubscriptionRestricted(tx: Transaction, now: Date = new Date()): Promise<boolean> {
  const [row] = await tx.execute<{ d: string | null }>(sql`select public.tenant_subscription_paid_until()::text as d`);
  return subscriptionAccess(row?.d ?? null, now) === "restricted";
}

function toPayload(p: NowPaymentsPayment): Record<string, unknown> {
  return {
    payment_id: p.paymentId,
    payment_status: p.status,
    order_id: p.orderId,
    price_amount: p.priceAmount ?? null,
    price_currency: p.priceCurrency,
    pay_amount: p.payAmount ?? null,
    pay_currency: p.payCurrency,
    pay_address: p.payAddress,
    actually_paid: p.actuallyPaid ?? null,
    payin_hash: p.payinHash,
  };
}

/** Applies one inbound event to its charge inside the charge's tenant transaction. */
export async function settleSubscriptionEvent(deps: SubscriptionBillingDeps, data: unknown): Promise<SettleOutcome> {
  const d = data as { eventId?: unknown; tenantId?: unknown } | null;
  if (!d || !isUuid(d.eventId) || !isUuid(d.tenantId)) throw new UnrecoverableError("invalid job data");
  const eventId = d.eventId;
  const outcome = await withTenant(deps.db, d.tenantId, async (tx): Promise<SettleOutcome> => {
    // RLS: a forged tenantId finds nothing.
    const [event] = await tx.execute<{ dedupe_key: string; payload: unknown }>(
      sql`select dedupe_key, payload from inbound_events where id = ${eventId} and provider = 'nowpayments'`,
    );
    if (!event) throw new UnrecoverableError("subscription event not found");
    const mark = (error: string | null) =>
      tx.execute(sql`update inbound_events set processed_at = now(), error = ${error} where id = ${eventId}`);

    let report: NowPaymentsPayment;
    try {
      report = parseNowPaymentsPayment(event.payload);
    } catch (err) {
      if (err instanceof PaymentProviderError) {
        await mark("invalid_payload");
        return "mismatch";
      }
      throw err;
    }
    const orderId = report.orderId && isUuid(report.orderId) ? report.orderId : null;
    const [charge] = orderId ? await tx.select().from(subscriptionCharges).where(eq(subscriptionCharges.id, orderId)).limit(1) : [];
    if (!charge) {
      await mark("unknown_charge");
      return "not_found";
    }
    const local: LocalCharge = {
      id: charge.id,
      status: charge.status,
      providerPaymentId: charge.providerPaymentId,
      priceAmount: charge.priceAmount,
      priceCurrency: charge.priceCurrency,
      payAmount: charge.payAmount,
      plan: charge.plan,
      periodDays: charge.periodDays,
    };
    const decision = decideSettlement(local, {
      paymentId: report.paymentId,
      status: report.status,
      orderId: report.orderId,
      priceAmount: report.priceAmount,
      priceCurrency: report.priceCurrency,
      payAmount: report.payAmount,
      actuallyPaid: report.actuallyPaid,
    });
    if (decision.kind === "ignore") {
      await mark(decision.reason === "mismatch" ? "mismatch" : null);
      return decision.reason === "mismatch" ? "mismatch" : "ignored";
    }
    const verifiedBy = event.dedupe_key.startsWith("reconcile:") ? "reconciliation" : "webhook";
    const [applied] = await tx.execute<{ outcome: SettleOutcome }>(sql`
      select outcome from public.subscription_charge_apply(
        ${charge.id}::uuid, ${decision.status}, ${verifiedBy}, ${report.status.slice(0, 40)},
        ${decision.actuallyPaid}::numeric, ${report.payinHash})`);
    const result = applied?.outcome ?? "not_found";
    await mark(result === "payin_hash_conflict" || result === "underpaid" ? result : null);
    return result;
  });
  if (outcome === "paid" || outcome === "refunded" || outcome === "mismatch" || outcome === "payin_hash_conflict") {
    (deps.logger ?? silent).info(`subscription event ${eventId}: ${outcome}`);
  }
  return outcome;
}

export interface ReconcileTickResult {
  polled: number;
  settled: number;
  failed: number;
}

/** Polls pending charges and settles them through the same path as IPNs. */
export async function runSubscriptionReconcileTick(deps: SubscriptionBillingDeps): Promise<ReconcileTickResult> {
  const res: ReconcileTickResult = { polled: 0, settled: 0, failed: 0 };
  const provider = deps.provider;
  if (!provider) return res;
  const rows = await deps.db.execute<{ charge_id: string; tenant_id: string; provider_payment_id: string }>(
    sql`select charge_id, tenant_id, provider_payment_id from public.subscription_stale_charges(${SUBSCRIPTION_RECONCILE_MIN_AGE_S}, 50)`,
  );
  for (const row of rows) {
    res.polled++;
    try {
      const payment = await provider.getPayment(row.provider_payment_id);
      const key = `reconcile:nowpayments:${payment.paymentId}:${payment.status.toLowerCase()}`;
      // Ingest under OUR charge id: a provider-side order id mismatch is caught by decideSettlement.
      const [ev] = await deps.db.execute<{ event_id: string | null; tenant_id: string }>(
        sql`select event_id, tenant_id from public.ingest_nowpayments_event(${key}, ${row.charge_id}, ${JSON.stringify(toPayload(payment))}::jsonb)`,
      );
      if (!ev?.event_id) continue;
      const outcome = await settleSubscriptionEvent(deps, { eventId: ev.event_id, tenantId: ev.tenant_id });
      if (outcome === "paid" || outcome === "refunded" || outcome === "failed" || outcome === "expired") res.settled++;
    } catch (err) {
      // One charge failing (provider down, bad data) must not starve the others; next tick retries.
      res.failed++;
      (deps.logger ?? silent).warn(`subscription reconcile failed for a charge (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}

/**
 * Switches tenant plans whose covering paid period changed (a stacked charge whose period began).
 * Settlement never grants a future period's plan early (finding F7, migration 0065).
 */
export async function runSubscriptionPlanSync(deps: Pick<SubscriptionBillingDeps, "db" | "logger">, limit = 200): Promise<number> {
  const [row] = await deps.db.execute<{ n: number | null }>(sql`select public.subscription_plan_sync_due(${limit}) as n`);
  const n = Number(row?.n ?? 0);
  if (n > 0) (deps.logger ?? silent).info(`subscription plan sync: ${n} tenant(s) switched`);
  return n;
}

export interface SubscriptionBillingWorkerOptions extends SubscriptionBillingDeps {
  connection: ConnectionOptions;
  queueName?: string;
}

export function createSubscriptionBillingWorker(opts: SubscriptionBillingWorkerOptions): Worker {
  const { connection, queueName = SUBSCRIPTION_BILLING_QUEUE_NAME, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name === SETTLE_SUBSCRIPTION_EVENT_JOB) return settleSubscriptionEvent(deps, job.data);
      if (job.name === SUBSCRIPTION_RECONCILE_TICK_JOB) {
        const res = await runSubscriptionReconcileTick(deps);
        await runSubscriptionPlanSync(deps);
        return res;
      }
      throw new UnrecoverableError("unknown job name");
    },
    { connection, concurrency: 2 },
  );
}

/** Registers (idempotently) the repeatable reconciliation tick. */
export async function scheduleSubscriptionReconcileTick(
  queue: Pick<Queue, "upsertJobScheduler">,
  everyMs = SUBSCRIPTION_RECONCILE_EVERY_MS,
): Promise<void> {
  await queue.upsertJobScheduler(
    SUBSCRIPTION_RECONCILE_SCHEDULER_ID,
    { every: everyMs },
    { name: SUBSCRIPTION_RECONCILE_TICK_JOB, data: {}, opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } } },
  );
}
