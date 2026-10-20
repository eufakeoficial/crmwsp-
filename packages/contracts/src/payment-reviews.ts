import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

export const paymentReviewStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type PaymentReviewStatus = z.infer<typeof paymentReviewStatusSchema>;
export const paymentReviewExtractionSchema = z.enum(["extracted", "unsupported", "failed"]);

/**
 * Receipt sent by a customer, awaiting human verification. The extracted fields are a hint for the
 * reviewer only: the order is never marked paid from them.
 */
export const paymentReviewSchema = z.object({
  id: uuidSchema,
  status: paymentReviewStatusSchema,
  extraction: paymentReviewExtractionSchema,
  order: z.object({
    id: uuidSchema,
    number: z.string(),
    status: z.string(),
    totalMinor: z.number().int(),
    currency: z.string(),
  }),
  contact: z.object({ id: uuidSchema, name: z.string().nullable(), phoneE164: z.string().nullable() }),
  conversationId: uuidSchema,
  messageId: uuidSchema,
  hasImage: z.boolean(),
  /** Inbound attachment of the receipt; its signed URL exists only if the media was stored. */
  attachmentId: uuidSchema.nullable(),
  extracted: z.object({
    amountMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    date: z.string().nullable(),
    reference: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
  }),
  /** Extracted amount and currency equal the order total. */
  amountMatches: z.boolean(),
  reviewedBy: uuidSchema.nullable(),
  reviewedAt: isoDateTimeSchema.nullable(),
  rejectReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type PaymentReview = z.infer<typeof paymentReviewSchema>;

export const paymentReviewListSchema = z.object({ items: z.array(paymentReviewSchema) });
export type PaymentReviewList = z.infer<typeof paymentReviewListSchema>;

export const listPaymentReviewsQuerySchema = z.object({
  status: paymentReviewStatusSchema.default("pending"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const approvePaymentReviewRequestSchema = z.object({ note: z.string().trim().max(500).optional() });
export type ApprovePaymentReviewRequest = z.infer<typeof approvePaymentReviewRequestSchema>;
export const rejectPaymentReviewRequestSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type RejectPaymentReviewRequest = z.infer<typeof rejectPaymentReviewRequestSchema>;
