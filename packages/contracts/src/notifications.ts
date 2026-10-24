import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

export const notificationKindSchema = z.enum([
  "order_confirmed",
  "order_paid",
  "handoff",
  "approval_requested",
  "payment_review",
  "reminder",
  "channel_quality",
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSchema = z.object({
  id: uuidSchema,
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string().nullable(),
  entity: z.string().nullable(),
  entityId: uuidSchema.nullable(),
  conversationId: uuidSchema.nullable(),
  read: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const markNotificationsReadRequestSchema = z.union([
  z.object({ ids: z.array(uuidSchema).min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);
export type MarkNotificationsReadRequest = z.infer<typeof markNotificationsReadRequestSchema>;

/** Owner WhatsApp notifications (tenants.settings.notifications). */
export const notificationSettingsSchema = z.object({
  /** E.164 owner phone; the owner must have messaged the business in the last 24 h. */
  ownerPhoneE164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .nullable()
    .default(null),
  whatsappKinds: z.array(notificationKindSchema).default(["order_paid", "handoff", "approval_requested", "payment_review"]),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** Lenient read of stored settings: invalid data falls back to defaults (WhatsApp off). */
export function resolveNotificationSettings(raw: unknown): NotificationSettings {
  const parsed = notificationSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : notificationSettingsSchema.parse({});
}

/** Realtime event (SSE `notification.created`); ids only. */
export const notificationEventSchema = z.object({
  type: z.literal("notification.created"),
  notificationId: uuidSchema,
  kind: notificationKindSchema,
});
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
