import { z } from "zod";
import { currencySchema, isoDateTimeSchema, uuidSchema } from "./common.js";

/** Contacts directory (CRM screen). Separate from the inbox contact lookup under /contacts. */

export const marketingConsentStatusSchema = z.enum(["granted", "revoked", "none"]);
export type MarketingConsentStatus = z.infer<typeof marketingConsentStatusSchema>;

export const contactTagSchema = z.string().trim().min(1).max(40);

/** Manual contact creation. The phone is normalized to E.164 by the API (humans type spaces, dashes, "00"). */
export const createContactRequestSchema = z.object({
  phone: z.string().trim().min(5).max(30),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
});
export type CreateContactRequest = z.infer<typeof createContactRequestSchema>;

export const contactBookItemSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  phoneE164: z.string(),
  tags: z.array(z.string()),
  marketingConsent: marketingConsentStatusSchema,
  /** Latest conversation of the contact (null when they never wrote). */
  conversationId: uuidSchema.nullable(),
  lastMessageAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ContactBookItem = z.infer<typeof contactBookItemSchema>;

export const listContactBookQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListContactBookQuery = z.infer<typeof listContactBookQuerySchema>;

export const contactBookListSchema = z.object({
  items: z.array(contactBookItemSchema),
  nextCursor: z.string().nullable(),
});
export type ContactBookList = z.infer<typeof contactBookListSchema>;

export const contactBookDocSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: z.string(),
  currency: currencySchema,
  totalMinor: z.number().int(),
  createdAt: isoDateTimeSchema,
});
export type ContactBookDoc = z.infer<typeof contactBookDocSchema>;

export const contactBookDetailSchema = contactBookItemSchema.extend({
  /** Orders not yet delivered, cancelled or refunded. */
  openOrdersCount: z.number().int(),
  /** Quotes in draft, pending approval, approved or sent. */
  openQuotesCount: z.number().int(),
  orders: z.array(contactBookDocSchema),
  quotes: z.array(contactBookDocSchema),
});
export type ContactBookDetail = z.infer<typeof contactBookDetailSchema>;

export const patchContactTagsRequestSchema = z.object({
  tags: z.array(contactTagSchema).max(30),
});
export type PatchContactTagsRequest = z.infer<typeof patchContactTagsRequestSchema>;

export const setMarketingConsentRequestSchema = z.object({ granted: z.boolean() });
export type SetMarketingConsentRequest = z.infer<typeof setMarketingConsentRequestSchema>;
