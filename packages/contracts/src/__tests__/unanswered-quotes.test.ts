import { describe, expect, it } from "vitest";
import { inboxCountsSchema } from "../inbox-v2.js";
import { listUnansweredQuotesQuerySchema, unansweredQuoteListResponseSchema, unansweredQuoteReviewSchema } from "../quotes.js";

const id = "0b0f6c3e-5b1c-4f5e-9a64-2a3c5d6e7f80";
const iso = "2026-11-24T12:00:00.000Z";

const item = {
  quoteId: id,
  number: "PRE-2026-0001",
  conversationId: id,
  contactId: id,
  contactName: "Ana",
  contactPhone: "+59171111111",
  totalMinor: 125000,
  currency: "BOB",
  sentAt: iso,
  eligibleAt: iso,
  validUntil: iso,
  assignee: { id, name: "Ana" },
  reminderAt: iso,
};

const list = (quote: unknown) => ({ items: [quote], nextCursor: null, counts: { eligible: 1, unknownCoverage: 0 } });

describe("unanswered quotes contract", () => {
  it("defaults the page size and keeps it bounded", () => {
    expect(listUnansweredQuotesQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(listUnansweredQuotesQuerySchema.parse({ limit: "50", cursor: "abc" })).toEqual({ limit: 50, cursor: "abc" });
    expect(listUnansweredQuotesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(listUnansweredQuotesQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("keeps the original currency next to the minor amount", () => {
    expect(unansweredQuoteListResponseSchema.safeParse(list(item)).success).toBe(true);
    expect(unansweredQuoteListResponseSchema.safeParse(list({ ...item, currency: "bolivianos" })).success).toBe(false);
    const { currency: _dropped, ...withoutCurrency } = item;
    expect(unansweredQuoteListResponseSchema.safeParse(list(withoutCurrency)).success).toBe(false);
    expect(unansweredQuoteListResponseSchema.safeParse(list({ ...item, totalMinor: -1 })).success).toBe(false);
    expect(unansweredQuoteListResponseSchema.safeParse(list({ ...item, totalMinor: 12.5 })).success).toBe(false);
  });

  it("accepts unassigned chats, nameless contacts and no scheduled reminder", () => {
    const parsed = unansweredQuoteListResponseSchema.parse(list({ ...item, assignee: null, contactName: null, reminderAt: null }));
    expect(parsed.items[0]).toMatchObject({ assignee: null, contactName: null, reminderAt: null });
    expect(parsed.counts).toEqual({ eligible: 1, unknownCoverage: 0 });
    expect(unansweredQuoteListResponseSchema.safeParse({ ...list(item), counts: { eligible: 1 } }).success).toBe(false);
  });

  it("parses a review", () => {
    expect(unansweredQuoteReviewSchema.parse({ quoteId: id, messageId: id, reviewedBy: id, reviewedAt: iso })).toEqual({
      quoteId: id,
      messageId: id,
      reviewedBy: id,
      reviewedAt: iso,
    });
    expect(unansweredQuoteReviewSchema.safeParse({ quoteId: id, messageId: id, reviewedBy: id, reviewedAt: "24/11/2026" }).success).toBe(false);
    expect(unansweredQuoteReviewSchema.safeParse({ quoteId: id, messageId: id, reviewedAt: iso }).success).toBe(false);
  });

  it("folder badges expose the unanswered count only when the API sends it", () => {
    const base = { open: 1, closed: 0, unread: 0, mine: 0, unassigned: 1, remindersDue: 0, reminders: 0, tags: [] };
    expect(inboxCountsSchema.parse(base).unanswered).toBeUndefined();
    expect(inboxCountsSchema.parse({ ...base, unanswered: 3 }).unanswered).toBe(3);
    expect(inboxCountsSchema.safeParse({ ...base, unanswered: -1 }).success).toBe(false);
  });
});
