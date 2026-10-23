import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

export const followUpStatusSchema = z.enum(["suggested", "scheduled", "sent", "skipped", "cancelled"]);
export type FollowUpStatus = z.infer<typeof followUpStatusSchema>;
export const followUpRuleSchema = z.enum(["manual", "lead_stalled", "order_pending_payment", "quote_unanswered"]);
export type FollowUpRule = z.infer<typeof followUpRuleSchema>;

export const followUpSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  conversationId: uuidSchema,
  opportunityId: uuidSchema.nullable(),
  quoteId: uuidSchema.nullable(),
  orderId: uuidSchema.nullable(),
  rule: followUpRuleSchema,
  reason: z.string(),
  messageBody: z.string().nullable(),
  templateId: uuidSchema.nullable(),
  requiresTemplate: z.boolean(),
  scheduledAt: isoDateTimeSchema,
  status: followUpStatusSchema,
  skipReason: z.string().nullable(),
  sentMessageId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FollowUp = z.infer<typeof followUpSchema>;
export const followUpListSchema = z.object({ items: z.array(followUpSchema) });
export type FollowUpList = z.infer<typeof followUpListSchema>;

export const listFollowUpsQuerySchema = z.object({
  contactId: uuidSchema.optional(),
  conversationId: uuidSchema.optional(),
  status: followUpStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;

const bodySchema = z.string().trim().min(1).max(4096);

export const createFollowUpRequestSchema = z
  .object({
    conversationId: uuidSchema,
    reason: z.string().trim().min(1).max(500),
    scheduledAt: isoDateTimeSchema,
    messageBody: bodySchema.optional(),
    templateId: uuidSchema.optional(),
    opportunityId: uuidSchema.optional(),
    quoteId: uuidSchema.optional(),
    orderId: uuidSchema.optional(),
    /** `suggested` waits for a person to confirm; `scheduled` is dispatched by the engine. */
    status: z.enum(["suggested", "scheduled"]).default("scheduled"),
  })
  .refine((v) => v.messageBody !== undefined || v.templateId !== undefined, {
    message: "messageBody or templateId is required",
  });
export type CreateFollowUpRequest = z.infer<typeof createFollowUpRequestSchema>;

export const patchFollowUpRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
    scheduledAt: isoDateTimeSchema.optional(),
    messageBody: bodySchema.nullable().optional(),
    templateId: uuidSchema.nullable().optional(),
    /** Only pending follow-ups can move, and only between pending states or to `cancelled`. */
    status: z.enum(["suggested", "scheduled", "cancelled"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });
export type PatchFollowUpRequest = z.infer<typeof patchFollowUpRequestSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

const ruleSettingsSchema = z.object({
  enabled: z.boolean(),
  delayHours: z.number().int().min(1).max(24 * 14),
  message: bodySchema,
  /** Approved template used when the 24 h window is closed; without it the follow-up is skipped. */
  templateId: uuidSchema.nullable(),
});

/** Tenant follow-up settings, stored under `tenants.settings.followUps`. */
export const followUpSettingsSchema = z.object({
  leadStalled: ruleSettingsSchema,
  orderPendingPayment: ruleSettingsSchema,
  /** Quote sent (status `sent`) and the contact has not written since. */
  quoteUnanswered: ruleSettingsSchema,
  /** Local (tenant timezone) window in which nothing is sent; may wrap midnight. Null disables it. */
  quietHours: z.object({ start: hhmm, end: hhmm }).nullable(),
});
export type FollowUpSettings = z.infer<typeof followUpSettingsSchema>;

export const patchFollowUpSettingsRequestSchema = z.object({
  leadStalled: ruleSettingsSchema.partial().optional(),
  orderPendingPayment: ruleSettingsSchema.partial().optional(),
  quoteUnanswered: ruleSettingsSchema.partial().optional(),
  quietHours: z.object({ start: hhmm, end: hhmm }).nullable().optional(),
});
export type PatchFollowUpSettingsRequest = z.infer<typeof patchFollowUpSettingsRequestSchema>;
