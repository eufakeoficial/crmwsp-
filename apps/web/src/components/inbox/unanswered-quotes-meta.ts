import type { MembershipRole, UnansweredQuote } from "@crmwsp/contracts";
import { ApiError } from "../../lib/api";
import { errorMessage } from "../../lib/messages";

export const UNANSWERED_FOLDER_LABEL = "Presupuestos sin respuesta";

export function canReviewQuotes(role: MembershipRole | undefined, viewingAs: boolean): boolean {
  return !viewingAs && (role === "owner" || role === "admin" || role === "agent");
}

export function withoutQuote(items: readonly UnansweredQuote[], quoteId: string): UnansweredQuote[] {
  return items.filter((item) => item.quoteId !== quoteId);
}

export function appendQuotes(loaded: readonly UnansweredQuote[], next: readonly UnansweredQuote[]): UnansweredQuote[] {
  return [...loaded, ...next.filter((item) => !loaded.some((q) => q.quoteId === item.quoteId))];
}

export function quoteContactLabel(quote: Pick<UnansweredQuote, "contactName" | "contactPhone">): string {
  return quote.contactName?.trim() || quote.contactPhone;
}

export function unknownCoverageLabel(count: number): string {
  return count === 1
    ? "Hay 1 presupuesto enviado cuyo envío no se puede confirmar."
    : `Hay ${count} presupuestos enviados cuyo envío no se puede confirmar.`;
}

export function reviewErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) return "Ya no está pendiente: el cliente respondió o el presupuesto cambió.";
  if (err instanceof ApiError && err.status === 404) return "Ya no tienes acceso a esta conversación.";
  return errorMessage(err);
}
