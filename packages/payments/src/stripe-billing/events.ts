/**
 * Normalizes the Stripe events of SaaS card billing (ADR 0022). Input is the full event JSON
 * (already signature-verified by the API; the worker re-parses the stored copy). Handles both
 * the classic and the newer (2025+) shapes of invoice and subscription objects.
 */

export type StripeBillingEvent =
  | { kind: "checkout_completed"; eventId: string; createdAt: Date | null; customerId: string | null; subscriptionId: string | null; clientReferenceId: string | null; paymentStatus: string | null }
  | {
      kind: "invoice_paid";
      eventId: string;
      createdAt: Date | null;
      customerId: string | null;
      invoice: { invoiceId: string; customerId: string; subscriptionId: string | null; status: string; priceId: string | null; amountPaidMinor: number; currency: string };
    }
  | { kind: "invoice_payment_failed"; eventId: string; createdAt: Date | null; customerId: string | null; invoiceId: string | null; subscriptionId: string | null }
  | {
      kind: "subscription_updated" | "subscription_deleted";
      eventId: string;
      createdAt: Date | null;
      customerId: string | null;
      subscription: {
        subscriptionId: string;
        status: string;
        priceId: string | null;
        cancelAtPeriodEnd: boolean;
        currentPeriodEnd: Date | null;
      };
    }
  | { kind: "ignored"; eventId: string | null; createdAt: null; customerId: null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
/** Stripe expands some references to objects: accept either `"id"` or `{ id }`. */
const refId = (v: unknown): string | null => (isObj(v) ? str(v["id"]) : str(v));
const first = (v: unknown): Record<string, unknown> | null => {
  const data = isObj(v) ? v["data"] : null;
  return Array.isArray(data) && isObj(data[0]) ? data[0] : null;
};

function invoicePriceId(inv: Record<string, unknown>): string | null {
  const line = first(inv["lines"]);
  if (!line) return null;
  const price = line["price"];
  if (isObj(price)) return str(price["id"]);
  const details = isObj(line["pricing"]) ? line["pricing"]["price_details"] : null;
  return isObj(details) ? refId(details["price"]) : null;
}

function invoiceSubscriptionId(inv: Record<string, unknown>): string | null {
  const classic = refId(inv["subscription"]);
  if (classic) return classic;
  const parent = isObj(inv["parent"]) && isObj(inv["parent"]["subscription_details"]) ? inv["parent"]["subscription_details"] : null;
  return parent ? refId(parent["subscription"]) : null;
}

function periodEnd(sub: Record<string, unknown>): Date | null {
  let ts = sub["current_period_end"];
  if (typeof ts !== "number") {
    const item = first(sub["items"]);
    ts = item ? item["current_period_end"] : undefined;
  }
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : null;
}

export function parseStripeBillingEvent(raw: unknown): StripeBillingEvent {
  if (!isObj(raw)) return { kind: "ignored", eventId: null, createdAt: null, customerId: null };
  const eventId = str(raw["id"]);
  const obj = isObj(raw["data"]) && isObj(raw["data"]["object"]) ? raw["data"]["object"] : null;
  if (!eventId || !obj) return { kind: "ignored", eventId, createdAt: null, customerId: null };
  const customerId = refId(obj["customer"]);
  const created = typeof raw["created"] === "number" && Number.isFinite(raw["created"]) && raw["created"] > 0 ? new Date(raw["created"] * 1000) : null;

  switch (raw["type"]) {
    case "checkout.session.completed":
      return {
        kind: "checkout_completed",
        eventId,
        createdAt: created,
        customerId,
        subscriptionId: refId(obj["subscription"]),
        clientReferenceId: str(obj["client_reference_id"]),
        paymentStatus: str(obj["payment_status"], 40),
      };
    case "invoice.paid": {
      const invoiceId = str(obj["id"]);
      const amount = obj["amount_paid"];
      const currency = str(obj["currency"], 10);
      if (!invoiceId || !customerId || typeof amount !== "number" || !currency) return { kind: "ignored", eventId, createdAt: null, customerId: null };
      return {
        kind: "invoice_paid",
        eventId,
        createdAt: created,
        customerId,
        invoice: {
          invoiceId,
          customerId,
          subscriptionId: invoiceSubscriptionId(obj),
          status: str(obj["status"], 40) ?? "unknown",
          priceId: invoicePriceId(obj),
          amountPaidMinor: amount,
          currency,
        },
      };
    }
    case "invoice.payment_failed":
      return { kind: "invoice_payment_failed", eventId, createdAt: created, customerId, invoiceId: str(obj["id"]), subscriptionId: invoiceSubscriptionId(obj) };
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscriptionId = str(obj["id"]);
      const status = str(obj["status"], 40);
      if (!subscriptionId || !status) return { kind: "ignored", eventId, createdAt: null, customerId: null };
      const item = first(obj["items"]);
      const price = item && isObj(item["price"]) ? str(item["price"]["id"]) : null;
      return {
        kind: raw["type"] === "customer.subscription.deleted" ? "subscription_deleted" : "subscription_updated",
        eventId,
        createdAt: created,
        customerId,
        subscription: { subscriptionId, status, priceId: price, cancelAtPeriodEnd: obj["cancel_at_period_end"] === true, currentPeriodEnd: periodEnd(obj) },
      };
    }
    default:
      return { kind: "ignored", eventId, createdAt: null, customerId: null };
  }
}
