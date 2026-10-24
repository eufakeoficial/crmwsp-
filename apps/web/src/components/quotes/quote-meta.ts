import type { Quote, QuoteActivityEvent, QuoteActivityKind, QuoteStatus } from "@crmwsp/contracts";
import type { Tone } from "@/components/ui";

export const QUOTE_STATUS_ORDER: readonly QuoteStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Borrador",
  pending_approval: "Pendiente de aprobación",
  approved: "Aprobado",
  sent: "Enviado",
  accepted: "Aceptado",
  rejected: "Rechazado",
  expired: "Vencido",
  cancelled: "Cancelado",
};

export const QUOTE_STATUS_TONES: Record<QuoteStatus, Tone> = {
  draft: "paper",
  pending_approval: "warning",
  approved: "info",
  sent: "info",
  accepted: "success",
  rejected: "danger",
  expired: "danger",
  cancelled: "danger",
};

export const contactLabel = (q: Pick<Quote, "contact">): string => q.contact.name?.trim() || q.contact.phoneE164;

export type QuoteActionKey = "edit" | "submit" | "approve" | "reject" | "send" | "link" | "order";

/**
 * Mirrors the API state machine (quotes.controller.ts); the API stays the authority.
 * Approve/reject are owner/admin only.
 */
export function availableQuoteActions(status: QuoteStatus, role: string | undefined): QuoteActionKey[] {
  const canWrite = role === "owner" || role === "admin" || role === "agent";
  const canApprove = role === "owner" || role === "admin";
  if (!canWrite) return [];
  switch (status) {
    case "draft":
      return ["edit", "submit"];
    case "pending_approval":
      return canApprove ? ["approve", "reject"] : [];
    case "approved":
      return ["send"];
    case "sent":
      return ["link"];
    case "accepted":
      return ["order"];
    default:
      return [];
  }
}

/** Today + `days` as YYYY-MM-DD (local), for the date input. */
export function datePlusDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const QUOTE_ACTIVITY_LABELS: Record<QuoteActivityKind, string> = {
  quote_created: "Presupuesto creado",
  quote_approved: "Presupuesto aprobado",
  quote_sent: "Presupuesto enviado al cliente",
  quote_accepted: "Presupuesto aceptado por el cliente",
  order_created: "Pedido creado",
  payment_review_received: "Comprobante recibido",
  payment_review_approved: "Comprobante aprobado",
  payment_review_rejected: "Comprobante rechazado",
  order_paid: "Pago confirmado",
  order_cancelled: "Pedido cancelado",
};

const VERIFIER_LABELS = {
  webhook: "confirmado por el proveedor de pagos",
  reconciliation: "confirmado por conciliación",
  manual: "marcado manualmente por el equipo",
} as const;

/** Spanish text of one activity entry, e.g. "Pago confirmado · P-12 · confirmado por conciliación". */
export function activityText(e: QuoteActivityEvent): string {
  const parts: string[] = [QUOTE_ACTIVITY_LABELS[e.kind]];
  if (e.orderNumber) parts.push(e.orderNumber);
  if (e.kind === "order_paid" && e.verifiedBy) parts.push(VERIFIER_LABELS[e.verifiedBy]);
  return parts.join(" · ");
}
