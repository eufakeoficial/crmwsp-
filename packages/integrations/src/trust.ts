import type { NormalizedCommerceEvent } from "./types.js";

export interface OrderSnapshot {
  id: string;
  totalMinor: bigint;
  currency: string;
}

export type ExternalSaleDecision =
  | { link: true; orderId: string }
  | {
      link: false;
      reason:
        | "no_order_reference"
        | "not_body_signed"
        | "scheme_unconfirmed"
        | "not_approved"
        | "unknown_order"
        | "currency_mismatch"
        | "amount_mismatch";
    };

/**
 * Whether an external sale may be LINKED to a CRMWSP order. All must hold: the event references
 * an order id, the request was authenticated by a body HMAC with a confirmed scheme, the sale is
 * approved, the order exists in THIS tenant, and amount + currency match the order exactly.
 * Linking never transitions the order: that stays with the verified Stripe path or a human.
 */
export function decideExternalSale(ev: NormalizedCommerceEvent, order: OrderSnapshot | null): ExternalSaleDecision {
  const sale = ev.sale;
  if (!sale?.crmwspOrderId) return { link: false, reason: "no_order_reference" };
  if (ev.verification !== "hmac_body") return { link: false, reason: "not_body_signed" };
  if (!ev.schemeConfirmed) return { link: false, reason: "scheme_unconfirmed" };
  if (sale.status !== "approved") return { link: false, reason: "not_approved" };
  if (!order || order.id !== sale.crmwspOrderId) return { link: false, reason: "unknown_order" };
  if (!sale.currency || sale.currency !== order.currency.toUpperCase()) return { link: false, reason: "currency_mismatch" };
  if (sale.amountMinor === null || !Number.isSafeInteger(sale.amountMinor) || BigInt(sale.amountMinor) !== order.totalMinor) {
    return { link: false, reason: "amount_mismatch" };
  }
  return { link: true, orderId: order.id };
}
