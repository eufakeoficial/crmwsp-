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
