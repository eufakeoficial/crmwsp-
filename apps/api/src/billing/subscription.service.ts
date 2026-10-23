import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { getPlan, periodPriceUsd, type PlanId } from "@crmwsp/billing";
import {
  ExternalProviderError,
  NotFoundError,
  SETTLE_SUBSCRIPTION_EVENT_JOB,
  type SubscriptionChargeDto,
  type SubscriptionChargeList,
} from "@crmwsp/contracts";
import { desc, eq, sql, subscriptionCharges, type DbHandle, type SubscriptionCharge } from "@crmwsp/db";
import type { NowPaymentsProvider } from "@crmwsp/payments";
import type { Queue } from "bullmq";
import type { TenantDb } from "../db/tenant-db.js";
import { NOWPAYMENTS_PROVIDER, REUSE_PENDING_CHARGE_MS, SUBSCRIPTION_EVENT_STORE, SUBSCRIPTION_QUEUE, nowPaymentsIpnUrl } from "./subscription.constants.js";

export function toChargeDto(c: SubscriptionCharge): SubscriptionChargeDto {
  return {
    id: c.id,
    plan: c.plan,
    status: c.status,
    providerStatus: c.providerStatus,
    priceAmount: c.priceAmount,
    priceCurrency: c.priceCurrency,
    payCurrency: c.payCurrency,
    payAmount: c.payAmount,
    payAddress: c.payAddress,
    actuallyPaid: c.actuallyPaid,
    qrData: c.payAddress,
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    createdAt: c.createdAt.toISOString(),
  };
}

export interface IngestedSubscriptionEvent {
  eventId: string;
  tenantId: string;
  inserted: boolean;
}

/** Port over `ingest_nowpayments_event` (SECURITY DEFINER, 0061). */
export interface SubscriptionEventStore {
  ingest(dedupeKey: string, orderId: string | null, payload: unknown): Promise<IngestedSubscriptionEvent | null>;
}

export class PgSubscriptionEventStore implements SubscriptionEventStore {
  constructor(private readonly sql: DbHandle["sql"]) {}

  async ingest(dedupeKey: string, orderId: string | null, payload: unknown): Promise<IngestedSubscriptionEvent | null> {
    const rows = await this.sql<{ event_id: string | null; tenant_id: string; inserted: boolean }[]>`
      select event_id, tenant_id, inserted
      from public.ingest_nowpayments_event(${dedupeKey}, ${orderId}, ${JSON.stringify(payload ?? null)}::jsonb)`;
    const r = rows[0];
    return r?.event_id ? { eventId: r.event_id, tenantId: r.tenant_id, inserted: r.inserted } : null;
  }
}

/** Tenant-side subscription charging (ADR 0013). Never marks anything paid: the worker does. */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @Optional() @Inject(NOWPAYMENTS_PROVIDER) private readonly provider: NowPaymentsProvider | null,
    @Optional() @Inject(SUBSCRIPTION_QUEUE) private readonly queue: Pick<Queue, "add"> | null,
    @Inject(SUBSCRIPTION_EVENT_STORE) private readonly store: SubscriptionEventStore,
  ) {}

  /**
   * Creates (or reuses a fresh pending) NOWPayments invoice for one 30-day period of `planId`.
   * Order: local pending row first, then the provider call, then the provider id is attached.
   */
  async createCharge(db: TenantDb, planId: PlanId): Promise<SubscriptionChargeDto> {
    const provider = this.provider;
    if (!provider) throw new ExternalProviderError("nowpayments", "Subscription payments are not configured");
    const plan = getPlan(planId);
    const price = periodPriceUsd(plan);

    const reusable = await db.run(async (tx) => {
      const rows = await tx
        .select()
        .from(subscriptionCharges)
        .where(eq(subscriptionCharges.status, "pending"))
        .orderBy(desc(subscriptionCharges.createdAt))
        .limit(5);
      return rows.find(
        (c) => c.plan === plan.id && c.providerPaymentId !== null && Date.now() - c.createdAt.getTime() < REUSE_PENDING_CHARGE_MS,
      );
    });
    if (reusable) return toChargeDto(reusable);

    const chargeId = await db.run(async (tx) => {
      const [r] = await tx.execute<{ id: string }>(
        sql`select public.subscription_charge_create(${plan.id}, ${price}::numeric, 'usd', ${provider.payCurrency}, ${db.userId}::uuid) as id`,
      );
      if (!r?.id) throw new Error("subscription_charge_create returned no id");
      return r.id;
    });

    const created = await provider.createPayment({
      orderId: chargeId,
      priceAmount: price,
      priceCurrency: "usd",
      ipnCallbackUrl: nowPaymentsIpnUrl(),
      description: `CRMWSP ${plan.name} (30 días)`,
    });

    return db.run(async (tx) => {
      await tx.execute(
        sql`select public.subscription_charge_attach(${chargeId}::uuid, ${created.paymentId}, ${created.payAddress},
          ${created.payAmount}::numeric, ${created.payCurrency.toLowerCase()}, ${created.status.slice(0, 40)})`,
      );
      const [row] = await tx.select().from(subscriptionCharges).where(eq(subscriptionCharges.id, chargeId)).limit(1);
      if (!row) throw new NotFoundError();
      return toChargeDto(row);
    });
  }

  async listCharges(db: TenantDb): Promise<SubscriptionChargeList> {
    const rows = await db.run((tx) => tx.select().from(subscriptionCharges).orderBy(desc(subscriptionCharges.createdAt)).limit(50));
    return { items: rows.map(toChargeDto) };
  }

  /** Status polling. RLS: another tenant's id simply is not found. */
  async getCharge(db: TenantDb, id: string): Promise<SubscriptionChargeDto> {
    const [row] = await db.run((tx) => tx.select().from(subscriptionCharges).where(eq(subscriptionCharges.id, id)).limit(1));
    if (!row) throw new NotFoundError();
    return toChargeDto(row);
  }

  /**
   * Persists a VERIFIED IPN (inbound_events, dedupe `nowpayments:{payment_id}:{status}`) and
   * enqueues settlement. Returns false when the order id is unknown. A lost enqueue is recovered
   * by the reconciliation tick (it polls every pending charge).
   */
  async ingestIpn(paymentId: string, status: string, orderId: string | null, body: unknown): Promise<boolean> {
    const event = await this.store.ingest(`nowpayments:${paymentId}:${status.toLowerCase()}`, orderId, body);
    if (!event) return false;
    if (this.queue) {
      try {
        await this.queue.add(
          SETTLE_SUBSCRIPTION_EVENT_JOB,
          { eventId: event.eventId, tenantId: event.tenantId },
          { jobId: `settle-${event.eventId}`, attempts: 8, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } },
        );
      } catch (err) {
        this.logger.warn(`subscription settlement enqueue failed (${err instanceof Error ? err.name : "unknown"}); reconciliation will retry`);
      }
    }
    return true;
  }
}
