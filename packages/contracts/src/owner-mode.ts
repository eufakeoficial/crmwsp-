import { z } from "zod";

/* F9 "modo dueño": a verified owner/admin runs the CRM from their own WhatsApp. */

/** Strict E.164 for owner phones (min 7 digits after the country code prefix, same as the DB check). */
export const ownerPhoneE164Schema = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Invalid E.164 phone number");

export const OWNER_PHONE_STATUSES = ["pending", "verified"] as const;
export const ownerPhoneStatusSchema = z.enum(OWNER_PHONE_STATUSES);

export const ownerPhoneSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  phoneE164: z.string(),
  status: ownerPhoneStatusSchema,
  verifiedAt: z.string().nullable(),
  codeExpiresAt: z.string().nullable(),
  attemptsLeft: z.number().int(),
});
export type OwnerPhoneDto = z.infer<typeof ownerPhoneSchema>;

export const ownerModeStatusSchema = z.object({
  phone: ownerPhoneSchema.nullable(),
  aiPaused: z.boolean(),
});
export type OwnerModeStatus = z.infer<typeof ownerModeStatusSchema>;

export const registerOwnerPhoneRequestSchema = z.object({ phoneE164: ownerPhoneE164Schema });
export type RegisterOwnerPhoneRequest = z.infer<typeof registerOwnerPhoneRequestSchema>;

export const verifyOwnerPhoneRequestSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "code must be 6 digits") });
export type VerifyOwnerPhoneRequest = z.infer<typeof verifyOwnerPhoneRequestSchema>;

/** Intents the owner-mode interpreter may return (LLM Structured Outputs or slash shortcuts). */
export const OWNER_INTENTS = [
  "daily_summary",
  "pending_quotes",
  "pending_actions",
  "approve_action",
  "reject_action",
  "sales_week",
  "search_contact",
  "draft_reply",
  "pause_ai",
  "resume_ai",
  "help",
  "unknown",
] as const;
export const ownerIntentSchema = z.enum(OWNER_INTENTS);
export type OwnerIntent = z.infer<typeof ownerIntentSchema>;

/** Intents that change state: they only run after an explicit confirmation with a nonce. */
export const OWNER_MUTATING_INTENTS = ["approve_action", "reject_action", "draft_reply", "pause_ai", "resume_ai"] as const satisfies readonly OwnerIntent[];

/** Interpreter output (contract shape; the strict JSON schema sends the same fields as nullable). */
export const ownerCommandSchema = z.object({
  intent: ownerIntentSchema,
  /** Short reference of a pending action (first characters of its id or its list position). */
  actionRef: z.string().trim().max(64).nullable(),
  /** Free text for search_contact, or the customer name for draft_reply. */
  query: z.string().trim().max(120).nullable(),
  /** Message for the customer (draft_reply only). */
  replyText: z.string().trim().max(1000).nullable(),
});
export type OwnerCommandInterpretation = z.infer<typeof ownerCommandSchema>;
