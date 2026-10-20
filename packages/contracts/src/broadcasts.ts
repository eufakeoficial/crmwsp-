import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

export const broadcastStatusSchema = z.enum(["draft", "scheduled", "sending", "completed", "cancelled"]);
export type BroadcastStatus = z.infer<typeof broadcastStatusSchema>;
export const broadcastRecipientStatusSchema = z.enum(["pending", "sent", "delivered", "read", "failed", "skipped"]);
export type BroadcastRecipientStatus = z.infer<typeof broadcastRecipientStatusSchema>;

const tagSchema = z.string().trim().min(1).max(64);

export const broadcastAudienceSchema = z.object({
  /** Contacts must carry ALL these tags (empty = every contact with marketing opt-in). */
  tags: z.array(tagSchema).max(20).default([]),
  /** Contacts carrying ANY of these tags are excluded. */
  excludeTags: z.array(tagSchema).max(20).default([]),
  /** Saved contact segment the contacts must also match (contact book filters). */
  segmentId: uuidSchema.optional(),
});
export type BroadcastAudience = z.infer<typeof broadcastAudienceSchema>;

const fallbackSchema = z.string().trim().min(1).max(200).optional();
export const broadcastVariableSourceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("contact_name"), fallback: fallbackSchema }),
  z.object({ source: z.literal("contact_phone") }),
  z.object({
    source: z.literal("contact_field"),
    key: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/),
    fallback: fallbackSchema,
  }),
  z.object({ source: z.literal("static"), value: z.string().trim().min(1).max(200) }),
]);
export type BroadcastVariableSource = z.infer<typeof broadcastVariableSourceSchema>;

export const createBroadcastRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: uuidSchema,
  variableMapping: z.array(broadcastVariableSourceSchema).max(20).default([]),
  audience: broadcastAudienceSchema.default({ tags: [], excludeTags: [] }),
});
export type CreateBroadcastRequest = z.infer<typeof createBroadcastRequestSchema>;

/** Only drafts can be edited. */
export const patchBroadcastRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    templateId: uuidSchema.optional(),
    variableMapping: z.array(broadcastVariableSourceSchema).max(20).optional(),
    audience: broadcastAudienceSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing to update" });
export type PatchBroadcastRequest = z.infer<typeof patchBroadcastRequestSchema>;

/** Freezes the audience, books the sends against the plan and schedules (now when omitted). */
export const scheduleBroadcastRequestSchema = z.object({ scheduledAt: isoDateTimeSchema.optional() });
export type ScheduleBroadcastRequest = z.infer<typeof scheduleBroadcastRequestSchema>;

export const previewAudienceRequestSchema = z.object({ audience: broadcastAudienceSchema });
export type PreviewAudienceRequest = z.infer<typeof previewAudienceRequestSchema>;

export const audiencePreviewSchema = z.object({
  /** Recipients that would be messaged (marketing opt-in, deduped by phone). */
  count: z.number().int().nonnegative(),
  /** Contacts matching the tag filter but excluded for lack of opt-in or an opt-out. */
  excludedNoConsent: z.number().int().nonnegative(),
});
export type AudiencePreview = z.infer<typeof audiencePreviewSchema>;

export const broadcastStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type BroadcastStats = z.infer<typeof broadcastStatsSchema>;

export const broadcastSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  channelConnectionId: uuidSchema,
  templateId: uuidSchema,
  variableMapping: z.array(broadcastVariableSourceSchema),
  audience: broadcastAudienceSchema,
  status: broadcastStatusSchema,
  scheduledAt: isoDateTimeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  reservedSends: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Broadcast = z.infer<typeof broadcastSchema>;
export const broadcastListSchema = z.object({ items: z.array(broadcastSchema) });
export type BroadcastList = z.infer<typeof broadcastListSchema>;

export const listBroadcastsQuerySchema = z.object({
  status: broadcastStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ListBroadcastsQuery = z.infer<typeof listBroadcastsQuerySchema>;

/** Approved WhatsApp templates usable in a campaign. */
export const broadcastTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  language: z.string(),
  category: z.string(),
  body: z.string(),
  channelConnectionId: uuidSchema,
  placeholders: z.number().int().nonnegative(),
});
export type BroadcastTemplate = z.infer<typeof broadcastTemplateSchema>;
export const broadcastTemplateListSchema = z.object({ items: z.array(broadcastTemplateSchema) });
export type BroadcastTemplateList = z.infer<typeof broadcastTemplateListSchema>;
