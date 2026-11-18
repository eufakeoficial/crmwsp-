import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BILLING_PERIODS, PLAN_IDS, stripePriceId, type BillingPeriod, type PlanId, type StripePriceMap } from "@crmwsp/billing";
import {
  ExternalProviderError,
  SETTLE_STRIPE_BILLING_EVENT_JOB,
  ValidationError,
  type CardBilling,
  type BillingRedirect,
} from "@crmwsp/contracts";
import { eq, sql, subscriptionBillingAccounts, tenants, type DbHandle } from "@crmwsp/db";
import { PaymentProviderError, parseStripeBillingEvent, type StripeBillingClient } from "@crmwsp/payments";
import type { Queue } from "bullmq";
import type { TenantDb } from "../db/tenant-db.js";
import { SUBSCRIPTION_QUEUE } from "./subscription.constants.js";
import { STRIPE_BILLING_CLIENT, STRIPE_BILLING_EVENT_STORE, STRIPE_BILLING_PRICES } from "./card-billing.constants.js";

export interface IngestedStripeEvent {
  eventId: string;
  tenantId: string;
  inserted: boolean;
}

/** Port over `ingest_stripe_billing_event` (SECURITY DEFINER, migration 0081). */
export interface StripeBillingEventStore {
  ingest(dedupeKey: string, customerId: string | null, payload: unknown): Promise<IngestedStripeEvent | null>;
}

export class PgStripeBillingEventStore implements StripeBillingEventStore {
  constructor(private readonly sql: DbHandle["sql"]) {}

  async ingest(dedupeKey: string, customerId: string | null, payload: unknown): Promise<IngestedStripeEvent | null> {
    const rows = await this.sql<{ event_id: string | null; tenant_id: string; inserted: boolean }[]>`
      select event_id, tenant_id, inserted
      from public.ingest_stripe_billing_event(${dedupeKey}, ${customerId}, ${JSON.stringify(payload ?? null)}::jsonb)`;
    const r = rows[0];
    return r?.event_id ? { eventId: r.event_id, tenantId: r.tenant_id, inserted: r.inserted } : null;
  }
}

/** Where Stripe sends the browser back to (the billing settings screen). */
export function billingReturnUrl(webUrl: string, result?: "success" | "cancel"): string {
  const base = `${webUrl.replace(/\/+$/, "")}/app/settings/billing`;
  return result ? `${base}?card=${result}` : base;
}

/**
 * Card billing with Stripe Billing (ADR 0022), tenant side. Never marks anything paid: it only
 * creates the Stripe customer / Checkout / portal sessions and persists verified webhooks for the
 * worker. Disabled (`enabled: false`, 503-style errors) when STRIPE_SECRET_KEY is unset.
 */
@Injectable()
export class CardBillingService {
  private readonly logger = new Logger(CardBillingService.name);

  constructor(
    @Optional() @Inject(STRIPE_BILLING_CLIENT) private readonly stripe: StripeBillingClient | null,
    @Optional() @Inject(STRIPE_BILLING_PRICES) private readonly prices: StripePriceMap | null,
    @Inject(STRIPE_BILLING_EVENT_STORE) private readonly store: StripeBillingEventStore,
    @Optional() @Inject(SUBSCRIPTION_QUEUE) private readonly queue: Pick<Queue, "add"> | null,
  ) {}

  private available(): Array<{ plan: PlanId; period: BillingPeriod }> {
    if (!this.stripe || !this.prices) return [];
    const out: Array<{ plan: PlanId; period: BillingPeriod }> = [];
    for (const plan of PLAN_IDS) for (const period of BILLING_PERIODS) if (stripePriceId(this.prices, plan, period)) out.push({ plan, period });
    return out;
  }

  async status(db: TenantDb): Promise<CardBilling> {
    const available = this.available();
    const [acct] = await db.run((tx) => tx.select().from(subscriptionBillingAccounts).limit(1));
    return {
      enabled: available.length > 0,
      available,
      subscription:
        acct && acct.status !== "none"
          ? {
              status: acct.status,
              plan: acct.plan,
              period: acct.period,
              cancelAtPeriodEnd: acct.cancelAtPeriodEnd,
              currentPeriodEnd: acct.currentPeriodEnd ? acct.currentPeriodEnd.toISOString() : null,
            }
          : null,
    };
  }

  /** Stripe customer of the tenant: created on first use, then reused (attach is once per tenant). */
  private async customerFor(db: TenantDb, stripe: StripeBillingClient): Promise<string> {
    const existing = await db.run(async (tx) => (await tx.select({ id: subscriptionBillingAccounts.stripeCustomerId }).from(subscriptionBillingAccounts).limit(1))[0]?.id);
    if (existing) return existing;
    const name = await db.run(async (tx) => (await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, db.tenantId)))[0]?.name);
    // Provider call outside any transaction; Stripe de-duplicates by the per-tenant idempotency key.
    const created = await stripe.createCustomer({ tenantId: db.tenantId, ...(name ? { name } : {}) });
    const stored = await db.run(async (tx) => (await tx.execute<{ id: string }>(sql`select public.stripe_billing_account_attach(${created.id}) as id`))[0]?.id);
    if (!stored) throw new ExternalProviderError("stripe", "Could not store the billing account");
    return stored;
  }

  async checkout(db: TenantDb, plan: PlanId, period: BillingPeriod, webUrl: string): Promise<BillingRedirect> {
    const stripe = this.requireStripe();
    const priceId = this.prices ? stripePriceId(this.prices, plan, period) : null;
    if (!priceId) throw new ValidationError("Card billing is not available for this plan and period");
    const customerId = await this.customerFor(db, stripe);
    try {
      const session = await stripe.createCheckoutSession({
        customerId,
        priceId,
        tenantId: db.tenantId,
        plan,
        period,
        successUrl: billingReturnUrl(webUrl, "success"),
        cancelUrl: billingReturnUrl(webUrl, "cancel"),
      });
      return { url: session.url };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async portal(db: TenantDb, webUrl: string): Promise<BillingRedirect> {
    const stripe = this.requireStripe();
    const existing = await db.run(async (tx) => (await tx.select({ id: subscriptionBillingAccounts.stripeCustomerId }).from(subscriptionBillingAccounts).limit(1))[0]?.id);
    if (!existing) throw new ValidationError("No card subscription yet");
    try {
      const session = await stripe.createPortalSession({ customerId: existing, returnUrl: billingReturnUrl(webUrl) });
      return { url: session.url };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * Persists one signature-verified event (first, per CLAUDE.md) and enqueues its settlement.
   * Returns false for events of unknown customers or types we do not act on (acknowledged, dropped).
   */
  async ingestEvent(body: unknown): Promise<boolean> {
    const ev = parseStripeBillingEvent(body);
    if (ev.kind === "ignored" || !ev.customerId) return false;
    const stored = await this.store.ingest(`stripe_billing:${ev.eventId}`, ev.customerId, body);
    if (!stored) return false;
    if (this.queue) {
      try {
        await this.queue.add(
          SETTLE_STRIPE_BILLING_EVENT_JOB,
          { eventId: stored.eventId, tenantId: stored.tenantId },
          { jobId: `settle-stripe-${stored.eventId}`, attempts: 8, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } },
        );
      } catch (err) {
        // The event is stored; Stripe also retries unacknowledged deliveries, but we answered 2xx.
        this.logger.warn(`stripe billing settlement enqueue failed (${err instanceof Error ? err.name : "unknown"})`);
      }
    }
    return true;
  }

  private requireStripe(): StripeBillingClient {
    if (!this.stripe) throw new ExternalProviderError("stripe", "Card billing is not configured");
    return this.stripe;
  }

  private mapError(err: unknown): Error {
    if (err instanceof PaymentProviderError) return new ExternalProviderError("stripe", "Card billing is temporarily unavailable");
    return err instanceof Error ? err : new Error("unknown");
  }
}
