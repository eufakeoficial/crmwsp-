import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  billingPeriodDays,
  billingPeriodFromDays,
  couponIneligibility,
  getPlan,
  isPlanId,
  normalizeCouponCode,
  periodPriceUsd,
  quoteCharge,
  type BillingPeriod,
  type CouponDefinition,
  type CouponType,
  type PlanId,
} from "@crmwsp/billing";
import {
  ExternalProviderError,
  NotFoundError,
  SETTLE_SUBSCRIPTION_EVENT_JOB,
  ValidationError,
  couponIneligibilitySchema,
  type CouponIneligibilityDto,
  type SubscriptionChargeDto,
  type SubscriptionChargeList,
  type SubscriptionQuote,
} from "@crmwsp/contracts";
import { desc, eq, sql, subscriptionCharges, type DbHandle, type SubscriptionCharge, type Transaction } from "@crmwsp/db";
import type { NowPaymentsProvider } from "@crmwsp/payments";
import type { Queue } from "bullmq";
import type { TenantDb } from "../db/tenant-db.js";
import { NOWPAYMENTS_PROVIDER, REUSE_PENDING_CHARGE_MS, SUBSCRIPTION_EVENT_STORE, SUBSCRIPTION_QUEUE, nowPaymentsIpnUrl } from "./subscription.constants.js";

export function toChargeDto(c: SubscriptionCharge): SubscriptionChargeDto {
  return {
    id: c.id,
    plan: c.plan,
    period: billingPeriodFromDays(c.periodDays) ?? "monthly",
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
    listPriceAmount: c.listPriceAmount,
    discountAmount: c.discountAmount,
    couponCode: c.couponCode,
    referralCredits: c.referralCredits,
    verifiedBy: c.verifiedBy,
    periodDays: c.periodDays,
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
   * Server-side price of one period (ADR 0017): plan price for the period minus a valid coupon or,
   * without a coupon, referral credits (monthly only). Never trusts a client price.
   */
  async quote(db: TenantDb, planId: PlanId, period: BillingPeriod = "monthly", couponCode?: string): Promise<SubscriptionQuote> {
    return db.run((tx) => this.quoteTx(tx, planId, period, couponCode));
  }

  private async quoteTx(tx: Transaction, planId: PlanId, period: BillingPeriod, couponCode?: string): Promise<SubscriptionQuote> {
    const plan = getPlan(planId);
    let coupon: CouponDefinition | null = null;
    let couponError: CouponIneligibilityDto | null = null;
    if (couponCode !== undefined) {
      const found = await lookupCoupon(tx, couponCode);
      if (!found) couponError = "not_found";
      else {
        const reason = couponIneligibility(found.coupon, found.usage, plan.id, found.coupon.type === "free_days" ? null : period, new Date());
        if (reason) couponError = reason;
        else coupon = found.coupon;
      }
    }
    const credits = 0; // referral credits: T2
    const q = quoteCharge(plan.id, period, coupon, credits);
    return {
      plan: plan.id,
      period,
      ...q,
      coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null,
      couponError,
      referralCredits: coupon ? 0 : Math.min(credits, 5),
    };
  }

  /**
   * Creates (or reuses a fresh pending) NOWPayments invoice for one period of `planId`:
   * monthly = 30 days at `priceMonthlyUsd`, annual = 365 days at `priceAnnualUsd` (ADR 0015),
   * minus a coupon or referral discount computed server-side (ADR 0017). A free result (100%
   * discount or free_days) is granted directly without calling NOWPayments.
   * Order: local pending row first, then the provider call, then the provider id is attached.
   */
  async createCharge(db: TenantDb, planId: PlanId, period: BillingPeriod = "monthly", couponCode?: string): Promise<SubscriptionChargeDto> {
    const plan = getPlan(planId);
    const listPrice = periodPriceUsd(plan, period);
    const days = billingPeriodDays(period);
    const quote = await this.quote(db, plan.id, period, couponCode);
    if (quote.couponError) throw new ValidationError("Coupon cannot be used", { details: { coupon: quote.couponError } });
    const code = quote.coupon?.code ?? null;

    if (quote.free) {
      return db.run(async (tx) => {
        const id = await mapCouponErrors(async () => {
          const [r] = code
            ? await tx.execute<{ id: string }>(
                sql`select public.subscription_coupon_grant(${code}, ${plan.id}, ${listPrice}::numeric, ${days}::integer, ${db.userId}::uuid) as id`,
              )
            : [];
          return r?.id;
        });
        if (!id) throw new Error("free period grant returned no id");
        const [row] = await tx.select().from(subscriptionCharges).where(eq(subscriptionCharges.id, id)).limit(1);
        if (!row) throw new NotFoundError();
        return toChargeDto(row);
      });
    }

    const provider = this.provider;
    if (!provider) throw new ExternalProviderError("nowpayments", "Subscription payments are not configured");

    const reusable = await db.run(async (tx) => {
      const rows = await tx
        .select()
        .from(subscriptionCharges)
        .where(eq(subscriptionCharges.status, "pending"))
        .orderBy(desc(subscriptionCharges.createdAt))
        .limit(5);
      return rows.find(
        (c) =>
          c.plan === plan.id &&
          c.periodDays === days &&
          c.couponCode === code &&
          c.referralCredits === quote.referralCredits &&
          c.providerPaymentId !== null &&
          Date.now() - c.createdAt.getTime() < REUSE_PENDING_CHARGE_MS,
      );
    });
    if (reusable) return toChargeDto(reusable);

    const stored = await db.run((tx) =>
      mapCouponErrors(async () => {
        let r: { id: string } | undefined;
        if (code) {
          [r] = await tx.execute<{ id: string }>(
            sql`select public.subscription_charge_create_with_coupon(${plan.id}, ${listPrice}::numeric, ${provider.payCurrency}, ${db.userId}::uuid, ${days}::integer, ${code}) as id`,
          );
        } else {
          [r] = await tx.execute<{ id: string }>(
            sql`select public.subscription_charge_create(${plan.id}, ${listPrice}::numeric, 'usd', ${provider.payCurrency}, ${db.userId}::uuid, ${days}::integer) as id`,
          );
        }
        if (!r?.id) throw new Error("subscription charge creation returned no id");
        const [row] = await tx.select().from(subscriptionCharges).where(eq(subscriptionCharges.id, r.id)).limit(1);
        if (!row) throw new NotFoundError();
        return row;
      }),
    );
    const chargeId = stored.id;

    // The provider is asked for the FINAL price stored by the database, never a client value.
    const created = await provider.createPayment({
      orderId: chargeId,
      priceAmount: stored.priceAmount,
      priceCurrency: "usd",
      ipnCallbackUrl: nowPaymentsIpnUrl(),
      description: `CRMWSP ${plan.name} (${days} días)`,
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

type CouponLookupRow = {
  coupon_id: string;
  code: string;
  type: CouponType;
  value: string;
  plans: string[] | null;
  period: CouponDefinition["period"];
  max_redemptions: number | null;
  per_tenant_limit: number;
  valid_from: string | Date | null;
  valid_until: string | Date | null;
  active: boolean;
  total_used: number;
  tenant_used: number;
};

/** Coupon by code for the current tenant (`coupon_lookup`, 0071), with its usage counts. */
async function lookupCoupon(tx: Transaction, raw: string): Promise<{ coupon: CouponDefinition; usage: { totalUsed: number; tenantUsed: number } } | null> {
  const code = normalizeCouponCode(raw);
  if (!code) return null;
  const [r] = await tx.execute<CouponLookupRow>(sql`
    select coupon_id, code, type, value, plans, period, max_redemptions, per_tenant_limit, valid_from, valid_until, active,
           total_used, tenant_used
    from public.coupon_lookup(${code})`);
  if (!r) return null;
  return {
    coupon: {
      id: r.coupon_id,
      code: r.code,
      type: r.type,
      value: Number(r.value),
      plans: (r.plans ?? []).filter(isPlanId),
      period: r.period,
      maxRedemptions: r.max_redemptions,
      perTenantLimit: r.per_tenant_limit,
      validFrom: r.valid_from ? new Date(r.valid_from) : null,
      validUntil: r.valid_until ? new Date(r.valid_until) : null,
      active: r.active,
    },
    usage: { totalUsed: Number(r.total_used), tenantUsed: Number(r.tenant_used) },
  };
}

/** SQL `22023 coupon: <reason>` (e.g. a lost race on max_redemptions) → 400 with the reason. */
async function mapCouponErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const reason = couponReason(err);
    if (reason) throw new ValidationError("Coupon cannot be used", { details: { coupon: reason } });
    throw err;
  }
}

/** Reason of a `coupon: <reason>` SQL error, if any (messages carry no data). */
export function couponReason(err: unknown): CouponIneligibilityDto | "free" | "not_free" | "no_credits" | null {
  const e = err as { message?: unknown; cause?: { message?: unknown } } | undefined;
  const msg = String(e?.cause?.message ?? e?.message ?? "");
  const m = /coupon: ([a-z_]+)/.exec(msg);
  if (!m?.[1]) return null;
  if (m[1] === "free" || m[1] === "not_free" || m[1] === "no_credits") return m[1];
  const parsed = couponIneligibilitySchema.safeParse(m[1]);
  return parsed.success ? parsed.data : null;
}
