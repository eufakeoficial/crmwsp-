import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

/** Order detected from a voice note, photo or PDF (F4). Prices shown come only from the catalog. */
export const orderExtractionSourceSchema = z.enum(["audio", "image", "pdf"]);
export const orderExtractionStatusSchema = z.enum(["needs_confirmation", "ready", "applied", "discarded", "skipped", "failed"]);
export type OrderExtractionStatus = z.infer<typeof orderExtractionStatusSchema>;

export const orderExtractionDudosoReasonSchema = z.enum([
  "no_match",
  "ambiguous",
  "low_confidence",
  "no_quantity",
  "unit_mismatch",
  "currency_mismatch",
]);

export const orderExtractionLineSchema = z.object({
  index: z.number().int().min(0),
  rawText: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  productGuess: z.string(),
  status: z.enum(["matched", "dudoso"]),
  reason: orderExtractionDudosoReasonSchema.nullable(),
  confidence: z.number().min(0).max(1),
  editedByUser: z.boolean(),
  match: z
    .object({
      productId: uuidSchema,
      variantId: uuidSchema.nullable(),
      label: z.string(),
      unit: z.string(),
      unitPriceMinor: z.number().int(),
      currency: z.string(),
    })
    .nullable(),
  /** Quantity in the catalog unit x 1000. */
  quantityMilli: z.number().int().nullable(),
  alternatives: z.array(z.object({ productId: uuidSchema, variantId: uuidSchema.nullable(), label: z.string(), score: z.number() })),
});
export type OrderExtractionLine = z.infer<typeof orderExtractionLineSchema>;

export const orderExtractionSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  messageId: uuidSchema,
  source: orderExtractionSourceSchema,
  status: orderExtractionStatusSchema,
  reason: z.string().nullable(),
  notes: z.string().nullable(),
  currency: z.string().nullable(),
  lines: z.array(orderExtractionLineSchema),
  quote: z.object({ id: uuidSchema, number: z.string(), status: z.string(), totalMinor: z.number().int() }).nullable(),
  lockVersion: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type OrderExtractionDto = z.infer<typeof orderExtractionSchema>;

export const orderExtractionListSchema = z.object({ items: z.array(orderExtractionSchema) });
export type OrderExtractionList = z.infer<typeof orderExtractionListSchema>;

export const listOrderExtractionsQuerySchema = z.object({
  conversationId: uuidSchema.optional(),
  status: orderExtractionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Agent fix of one line: pick a catalog product/variant and/or set the quantity in catalog units. */
export const updateOrderExtractionLineSchema = z
  .object({
    lockVersion: z.number().int().min(0),
    productId: uuidSchema.optional(),
    variantId: uuidSchema.nullable().optional(),
    /** Quantity in the catalog unit (e.g. 12 cajas -> 12). */
    quantity: z.number().positive().max(1_000_000).optional(),
    /** Drop the line from the quote. */
    remove: z.boolean().optional(),
  })
  .strict();
export type UpdateOrderExtractionLine = z.infer<typeof updateOrderExtractionLineSchema>;

export const discardOrderExtractionSchema = z.object({ lockVersion: z.number().int().min(0) }).strict();
