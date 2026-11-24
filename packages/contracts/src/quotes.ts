import { z } from "zod";
import { currencySchema, isoDateTimeSchema, uuidSchema } from "./common.js";

/**
 * Response of `POST /quotes/:id/accept-link`. The acceptance link is not stored (only its hash), so
 * asking for it issues a new one and the previously sent link stops working.
 */
export const quoteAcceptLinkSchema = z.object({
  url: z.string().url(),
  validUntil: isoDateTimeSchema,
});
export type QuoteAcceptLink = z.infer<typeof quoteAcceptLinkSchema>;

/** Kinds of entries in the read-only activity history of a quote and its orders. */
export const QUOTE_ACTIVITY_KINDS = [
  "quote_created",
  "quote_approved",
  "quote_sent",
  "quote_accepted",
  "order_created",
  "payment_review_received",
  "payment_review_approved",
  "payment_review_rejected",
  "order_paid",
  "order_cancelled",
] as const;
export const quoteActivityKindSchema = z.enum(QUOTE_ACTIVITY_KINDS);
export type QuoteActivityKind = z.infer<typeof quoteActivityKindSchema>;

/** How a payment was confirmed: provider webhook, reconciliation, or an audited manual mark. */
export const quoteActivityVerifierSchema = z.enum(["webhook", "reconciliation", "manual"]);
export type QuoteActivityVerifier = z.infer<typeof quoteActivityVerifierSchema>;

export const quoteActivityEventSchema = z.object({
  /** Stable, derived id (`kind:entityId`), usable as a React key. */
  id: z.string(),
  kind: quoteActivityKindSchema,
  at: isoDateTimeSchema,
  /** Order number for order/payment entries. */
  orderNumber: z.string().nullable(),
  /** Set on `order_paid` only; null when the source cannot tell. */
  verifiedBy: quoteActivityVerifierSchema.nullable(),
});
export type QuoteActivityEvent = z.infer<typeof quoteActivityEventSchema>;

/** Response of `GET /quotes/:id/activity`: oldest first, derived from existing records. */
export const quoteActivityResponseSchema = z.object({ items: z.array(quoteActivityEventSchema) });
export type QuoteActivityResponse = z.infer<typeof quoteActivityResponseSchema>;

/** Query of `GET /quotes/unanswered`: the inbox filter for sent quotes the customer has not answered. */
export const listUnansweredQuotesQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListUnansweredQuotesQuery = z.infer<typeof listUnansweredQuotesQuerySchema>;

export const unansweredQuoteCountsSchema = z.object({
  /** Cases the caller can act on right now, with the same filters as the list. */
  eligible: z.number().int().nonnegative(),
  /** Sent quotes in the window without a reliable link to their send message. */
  unknownCoverage: z.number().int().nonnegative(),
});
export type UnansweredQuoteCounts = z.infer<typeof unansweredQuoteCountsSchema>;

export const unansweredQuoteSchema = z.object({
  quoteId: uuidSchema,
  number: z.string(),
  /** Conversation the quote message was sent to. */
  conversationId: uuidSchema,
  contactId: uuidSchema,
  contactName: z.string().nullable(),
  contactPhone: z.string(),
  totalMinor: z.number().int().nonnegative(),
  currency: currencySchema,
  /** Instant the provider confirmed the quote message. */
  sentAt: isoDateTimeSchema,
  /** When the case started counting as unanswered (`sentAt` + the configured delay). */
  eligibleAt: isoDateTimeSchema,
  validUntil: isoDateTimeSchema,
  /** Conversation assignee; null when the chat is unassigned. */
  assignee: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  /** Pending automatic follow-up of the quote, when one is scheduled. */
  reminderAt: isoDateTimeSchema.nullable(),
});
export type UnansweredQuote = z.infer<typeof unansweredQuoteSchema>;

/** Response of `GET /quotes/unanswered`: oldest case first, keyset cursor. */
export const unansweredQuoteListResponseSchema = z.object({
  items: z.array(unansweredQuoteSchema),
  nextCursor: z.string().nullable(),
  counts: unansweredQuoteCountsSchema,
});
export type UnansweredQuoteListResponse = z.infer<typeof unansweredQuoteListResponseSchema>;

/** Response of `POST /quotes/unanswered/:quoteId/review`; repeating the call returns the same row. */
export const unansweredQuoteReviewSchema = z.object({
  quoteId: uuidSchema,
  messageId: uuidSchema,
  /** First reviewer; null when that user was deleted. */
  reviewedBy: uuidSchema.nullable(),
  reviewedAt: isoDateTimeSchema,
});
export type UnansweredQuoteReview = z.infer<typeof unansweredQuoteReviewSchema>;
