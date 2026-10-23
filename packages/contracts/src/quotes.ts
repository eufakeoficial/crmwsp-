import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

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
