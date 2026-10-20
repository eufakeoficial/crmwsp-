/**
 * Pure order state machine. Side effects (stock functions, payments) live in the API;
 * this only says which transitions are legal.
 */
export const ORDER_STATUSES = [
  "draft",
  "pending_payment",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderFulfillment = "shipping" | "pickup" | "digital" | "service";

export const ORDER_ACTIONS = ["confirm", "mark_paid", "cancel", "fulfill", "ship", "deliver"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export type OrderTransition =
  | { ok: true; to: OrderStatus }
  | { ok: false; reason: "invalid_state" | "not_applicable" };

const invalid: OrderTransition = { ok: false, reason: "invalid_state" };

/**
 * - confirm:   draft -> pending_payment
 * - mark_paid: pending_payment -> paid
 * - cancel:    draft | pending_payment -> cancelled (a paid order is a refund flow, not a cancel)
 * - fulfill:   paid -> fulfilled
 * - ship:      fulfilled -> shipped (shipping orders only; others are `not_applicable`)
 * - deliver:   shipped -> delivered; non-shipping orders go fulfilled -> delivered
 */
export function transitionOrder(status: OrderStatus, action: OrderAction, fulfillment: OrderFulfillment): OrderTransition {
  switch (action) {
    case "confirm":
      return status === "draft" ? { ok: true, to: "pending_payment" } : invalid;
    case "mark_paid":
      return status === "pending_payment" ? { ok: true, to: "paid" } : invalid;
    case "cancel":
      return status === "draft" || status === "pending_payment" ? { ok: true, to: "cancelled" } : invalid;
    case "fulfill":
      return status === "paid" ? { ok: true, to: "fulfilled" } : invalid;
    case "ship":
      if (fulfillment !== "shipping") return { ok: false, reason: "not_applicable" };
      return status === "fulfilled" ? { ok: true, to: "shipped" } : invalid;
    case "deliver":
      if (fulfillment === "shipping") return status === "shipped" ? { ok: true, to: "delivered" } : invalid;
      return status === "fulfilled" ? { ok: true, to: "delivered" } : invalid;
  }
}

export function availableOrderActions(status: OrderStatus, fulfillment: OrderFulfillment): OrderAction[] {
  return ORDER_ACTIONS.filter((a) => transitionOrder(status, a, fulfillment).ok);
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === "delivered" || status === "cancelled" || status === "refunded";
}
