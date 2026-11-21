import { decideStripeInvoice, mapStripeSubscriptionStatus, resolveStripePrice, type StripePriceMap } from "@crmwsp/billing";
import { isUuid, sql, withTenant, type Database } from "@crmwsp/db";
import { parseStripeBillingEvent } from "@crmwsp/payments";
import { UnrecoverableError } from "bullmq";
import type { Logger } from "../processors.js";

/**
 * Applies one persisted, signature-verified Stripe billing event (card billing, ADR 0022).
 * `paid` only comes from `invoice.paid` for one of OUR configured prices at the exact plan price
 * (`decideStripeInvoice`), settled atomically by `stripe_invoice_settle`, which is idempotent per
 * invoice. Subscription events only mirror Stripe's state on the billing account (informational):
 * access always follows the settled periods, so the existing grace and read-only rules apply.
 */

export interface StripeBillingDeps {
  db: Database;
  /** Configured price ids; empty = every invoice is ignored as `unknown_price`. */
  stripePrices: StripePriceMap;
  logger?: Logger;
}

export type StripeSettleOutcome =
  | "paid"
  | "ignored"
  | "synced"
  | "stale"
  | "unknown_customer"
  | "unknown_price"
  | "amount_mismatch"
  | "currency_mismatch"
  | "not_paid"
  | "invalid_payload"
  | "not_found";

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export async function settleStripeBillingEvent(deps: StripeBillingDeps, data: unknown): Promise<StripeSettleOutcome> {
  const d = data as { eventId?: unknown; tenantId?: unknown } | null;
  if (!d || !isUuid(d.eventId) || !isUuid(d.tenantId)) throw new UnrecoverableError("invalid job data");
  const eventId = d.eventId;

  const outcome = await withTenant(deps.db, d.tenantId, async (tx): Promise<StripeSettleOutcome> => {
    // RLS: a forged tenantId finds nothing.
    const [row] = await tx.execute<{ payload: unknown }>(sql`select payload from inbound_events where id = ${eventId} and provider = 'stripe'`);
    if (!row) throw new UnrecoverableError("stripe billing event not found");
    const mark = (error: string | null) => tx.execute(sql`update inbound_events set processed_at = now(), error = ${error} where id = ${eventId}`);

    const ev = parseStripeBillingEvent(row.payload);
    if (ev.kind === "ignored" || !ev.customerId) {
      await mark(null);
      return "ignored";
    }
    const customerId = ev.customerId;
    const eventAt = ev.createdAt;

    const sync = async (subscriptionId: string | null, status: string, plan: string | null, period: string | null, cancel: boolean | null, periodEnd: Date | null) => {
      const mapped = mapStripeSubscriptionStatus(status);
      if (!mapped) return "ignored" as const;
      const [res] = await tx.execute<{ ok: boolean }>(sql`
        select public.stripe_billing_subscription_sync(
          ${customerId}, ${subscriptionId}, ${mapped}, ${plan}, ${period}, ${cancel}, ${periodEnd?.toISOString() ?? null}::timestamptz, ${eventAt?.toISOString() ?? null}::timestamptz) as ok`);
      return res?.ok ? ("synced" as const) : ("stale" as const);
    };

    switch (ev.kind) {
      case "invoice_paid": {
        const decision = decideStripeInvoice(ev.invoice, deps.stripePrices);
        if (decision.kind === "ignore") {
          // Needs a human (stray price, discount, other currency): kept on the event, never settled.
          await mark(decision.reason === "not_paid" ? null : decision.reason);
          return decision.reason;
        }
        const [res] = await tx.execute<{ outcome: string }>(sql`
          select outcome from public.stripe_invoice_settle(
            ${customerId}, ${ev.invoice.invoiceId}, ${ev.invoice.subscriptionId}, ${decision.plan}, ${decision.periodDays}::integer,
            ${decision.amountMinor}::bigint, ${decision.currency})`);
        const result = res?.outcome ?? "not_found";
        await mark(result === "unknown_customer" ? "unknown_customer" : null);
        return result === "paid" || result === "ignored" || result === "unknown_customer" ? result : "not_found";
      }
      case "invoice_payment_failed": {
        // Stripe retries on its own schedule; we only reflect it. No access is revoked here:
        // without a later paid invoice the period simply runs out (grace, then read-only).
        const r = await sync(ev.subscriptionId, "past_due", null, null, null, null);
        await mark(null);
        return r;
      }
      case "subscription_updated":
      case "subscription_deleted": {
        const s = ev.subscription;
        const price = resolveStripePrice(s.priceId, deps.stripePrices);
        const status = ev.kind === "subscription_deleted" ? "canceled" : s.status;
        const r = await sync(s.subscriptionId, status, price?.plan ?? null, price?.period ?? null, s.cancelAtPeriodEnd, s.currentPeriodEnd);
        await mark(null);
        return r;
      }
      case "checkout_completed": {
        // The redirect never grants access; the paid invoice does. Only links the subscription.
        const r = ev.subscriptionId && ev.paymentStatus === "paid" ? await sync(ev.subscriptionId, "active", null, null, null, null) : "ignored";
        await mark(null);
        return r;
      }
    }
  });
  if (outcome === "paid" || outcome === "amount_mismatch" || outcome === "unknown_price" || outcome === "currency_mismatch" || outcome === "unknown_customer") {
    (deps.logger ?? silent).info(`stripe billing event ${eventId}: ${outcome}`);
  }
  return outcome;
}
