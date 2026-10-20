import { fromStripeAmount } from "../currency.js";
import { PaymentProviderError } from "../errors.js";
import type { PaymentReference, VerifiedPaymentEvent } from "../types.js";
import { chargeSchema, eventSchema, sessionSchema } from "./schemas.js";

function reference(metadata: Record<string, string> | null | undefined): PaymentReference | null {
  const tenantId = metadata?.tenantId;
  const kind = metadata?.kind;
  const id = metadata?.id;
  if (!tenantId || !id || (kind !== "order" && kind !== "quote")) return null;
  return { tenantId, kind, id };
}

function malformed(): PaymentProviderError {
  return new PaymentProviderError("stripe", "Malformed Stripe event payload", false);
}

/** Maps a (signature-verified) Stripe event JSON to a normalized event. Amounts are Stripe's, never the client's. */
export function normalizeStripeEvent(json: unknown): VerifiedPaymentEvent {
  const ev = eventSchema.safeParse(json);
  if (!ev.success) throw malformed();
  const { id: dedupeKey, type } = ev.data;
  const occurredAt = new Date(ev.data.created * 1000);
  const ignored = (): VerifiedPaymentEvent => ({ type: "ignored", eventType: type, dedupeKey, occurredAt });

  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const s = sessionSchema.safeParse(ev.data.data.object);
      if (!s.success || !s.data.currency || s.data.amount_total == null) throw malformed();
      const session = s.data;
      // `completed` with an unpaid status is a delayed method (e.g. SEPA debit): wait for the async event.
      if (type === "checkout.session.completed" && session.payment_status !== "paid") return ignored();
      if (type === "checkout.session.async_payment_succeeded" && session.payment_status !== "paid") return ignored();
      const currency = session.currency!.toUpperCase();
      const base = {
        providerRef: session.id,
        amountMinor: fromStripeAmount(session.amount_total!, currency),
        currency,
        reference: reference(session.metadata),
        occurredAt,
        dedupeKey,
        verifiedBy: "webhook" as const,
      };
      if (type === "checkout.session.expired") return { ...base, type: "payment.expired" };
      if (type === "checkout.session.async_payment_failed") return { ...base, type: "payment.failed" };
      return {
        ...base,
        type: "payment.succeeded",
        ...(session.payment_intent ? { paymentRef: session.payment_intent } : {}),
      };
    }
    case "charge.refunded": {
      const c = chargeSchema.safeParse(ev.data.data.object);
      if (!c.success) throw malformed();
      const charge = c.data;
      const currency = charge.currency.toUpperCase();
      return {
        type: "payment.refunded",
        providerRef: charge.payment_intent ?? charge.id,
        amountMinor: fromStripeAmount(charge.amount_refunded, currency),
        currency,
        reference: reference(charge.metadata),
        fullyRefunded: charge.amount_refunded >= charge.amount,
        occurredAt,
        dedupeKey,
        verifiedBy: "webhook",
      };
    }
    default:
      return ignored();
  }
}
