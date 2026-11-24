import type { MembershipRole, UnansweredQuote } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import { appendQuotes, canReviewQuotes, quoteContactLabel, reviewErrorMessage, unknownCoverageLabel, withoutQuote } from "./unanswered-quotes-meta";

const quote = (quoteId: string, patch: Partial<UnansweredQuote> = {}): UnansweredQuote => ({
  quoteId,
  number: `PRE-${quoteId}`,
  conversationId: "0b0f6c3e-5b1c-4f5e-9a64-2a3c5d6e7f80",
  contactId: "0b0f6c3e-5b1c-4f5e-9a64-2a3c5d6e7f81",
  contactName: "Ana",
  contactPhone: "+59171111111",
  totalMinor: 125000,
  currency: "BOB",
  sentAt: "2026-11-24T12:00:00.000Z",
  eligibleAt: "2026-11-26T12:00:00.000Z",
  validUntil: "2026-12-24T12:00:00.000Z",
  assignee: null,
  reminderAt: null,
  ...patch,
});

describe("unanswered quotes list state", () => {
  it("drops the reviewed quote without touching the others", () => {
    const items = [quote("a"), quote("b"), quote("c")];
    expect(withoutQuote(items, "b").map((i) => i.quoteId)).toEqual(["a", "c"]);
    expect(withoutQuote(items, "zzz").map((i) => i.quoteId)).toEqual(["a", "b", "c"]);
  });

  it("appends a page without repeating quotes that are already loaded", () => {
    const next = appendQuotes([quote("a"), quote("b")], [quote("b"), quote("c"), quote("a"), quote("d")]);
    expect(next.map((i) => i.quoteId)).toEqual(["a", "b", "c", "d"]);
    expect(appendQuotes([], [quote("a")])).toHaveLength(1);
  });
});

describe("unanswered quotes labels", () => {
  it("falls back to the phone when the contact has no name", () => {
    expect(quoteContactLabel(quote("a"))).toBe("Ana");
    expect(quoteContactLabel(quote("a", { contactName: "  " }))).toBe("+59171111111");
    expect(quoteContactLabel(quote("a", { contactName: null }))).toBe("+59171111111");
  });

  it("counts the unknown coverage in singular and plural", () => {
    expect(unknownCoverageLabel(1)).toBe("Hay 1 presupuesto enviado cuyo envío no se puede confirmar.");
    expect(unknownCoverageLabel(3)).toBe("Hay 3 presupuestos enviados cuyo envío no se puede confirmar.");
  });
});

describe("reviewing an unanswered quote", () => {
  it("is for owner, admin and agent, never while viewing as someone else", () => {
    const writers: MembershipRole[] = ["owner", "admin", "agent"];
    for (const role of writers) expect(canReviewQuotes(role, false)).toBe(true);
    expect(canReviewQuotes("viewer", false)).toBe(false);
    expect(canReviewQuotes(undefined, false)).toBe(false);
    for (const role of writers) expect(canReviewQuotes(role, true)).toBe(false);
  });

  it("explains why the review was refused", () => {
    expect(reviewErrorMessage(new ApiError("CONFLICT", "The quote is no longer waiting for an answer", 409))).toBe(
      "Ya no está pendiente: el cliente respondió o el presupuesto cambió.",
    );
    expect(reviewErrorMessage(new ApiError("NOT_FOUND", "Not found", 404))).toBe("Ya no tienes acceso a esta conversación.");
    expect(reviewErrorMessage(new ApiError("FORBIDDEN", "Forbidden", 403))).toBe("No tienes permiso para realizar esta acción.");
    expect(reviewErrorMessage(new Error("x"))).toBe("Ocurrió un error inesperado. Inténtalo de nuevo.");
  });
});
