import { StatusChip } from "@/components/ui";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES, type OrderStatus } from "./order-meta";

export function OrderStatusChip({ status }: { status: OrderStatus }) {
  return <StatusChip label={ORDER_STATUS_LABELS[status]} tone={ORDER_STATUS_TONES[status]} />;
}
