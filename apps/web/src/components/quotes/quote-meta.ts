import type { Quote, QuoteStatus } from "@crmwsp/contracts";
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

export const QUOTE_CURRENCIES = ["EUR", "USD", "MXN", "COP", "ARS", "CLP", "PEN", "BOB"] as const;

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
