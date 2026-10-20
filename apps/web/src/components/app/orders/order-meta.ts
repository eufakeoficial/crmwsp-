import type { Order } from "@crmwsp/contracts";
import type { Tone } from "@/components/ui";

export type OrderStatus = Order["status"];
export type OrderFulfillment = Order["fulfillment"];
export type OrderActionKey = "confirm" | "mark_paid" | "cancel" | "fulfill" | "ship" | "deliver";

export const ORDER_STATUS_ORDER: readonly OrderStatus[] = [
  "draft",
  "pending_payment",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Borrador",
  pending_payment: "Pendiente de pago",
  paid: "Pagado",
  fulfilled: "Preparado",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

export const ORDER_STATUS_TONES: Record<OrderStatus, Tone> = {
  draft: "paper",
  pending_payment: "warning",
  paid: "success",
  fulfilled: "info",
  shipped: "info",
  delivered: "success",
  cancelled: "danger",
  refunded: "danger",
};

export const FULFILLMENT_LABELS: Record<OrderFulfillment, string> = {
  shipping: "Envío",
  pickup: "Recogida",
  digital: "Digital",
  service: "Servicio",
};

export const ACTION_LABELS: Record<OrderActionKey, string> = {
  confirm: "Confirmar pedido",
  mark_paid: "Marcar como pagado",
  cancel: "Cancelar pedido",
  fulfill: "Marcar preparado",
  ship: "Marcar enviado",
  deliver: "Marcar entregado",
};

/** Mirrors the API state machine (packages/domain orders/state.ts); the API stays the authority. */
export function availableActions(status: OrderStatus, fulfillment: OrderFulfillment): OrderActionKey[] {
  switch (status) {
    case "draft":
      return ["confirm", "cancel"];
    case "pending_payment":
      return ["mark_paid", "cancel"];
    case "paid":
      return ["fulfill"];
    case "fulfilled":
      return fulfillment === "shipping" ? ["ship"] : ["deliver"];
    case "shipped":
      return ["deliver"];
    default:
      return [];
  }
}

export function paymentLabel(o: Pick<Order, "status" | "paidAt">): string {
  if (o.status === "refunded") return "Reembolsado";
  if (o.paidAt || ["paid", "fulfilled", "shipped", "delivered"].includes(o.status)) return "Pagado";
  if (o.status === "pending_payment") return "Pendiente";
  return "Sin cobrar";
}

export function optionsText(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

const dateFmt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });
export function formatDateTime(iso: string): string {
  return dateFmt.format(new Date(iso));
}
