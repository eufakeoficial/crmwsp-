import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";
import { conversationSchema } from "./inbox.js";

/** Inbox v2 (T23): ManyChat-style folders, assignment, notes, reminders, tags, canned responses. */

export const inboxStatusSchema = z.enum(["open", "closed"]);
export type InboxStatus = z.infer<typeof inboxStatusSchema>;

const boolParam = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

// --- Settings (tenants.settings.inbox) ------------------------------------------

export const inboxSettingsSchema = z.object({
  autoAssign: z.enum(["off", "round_robin"]).default("off"),
  /** Round robin skips agents with this many open chats (null = no cap). */
  maxOpenPerAgent: z.number().int().min(1).max(1000).nullable().default(null),
  /** `own`: agents only see conversations assigned to them plus unassigned ones. */
  visibility: z.enum(["all", "own"]).default("all"),
  /** A closed conversation goes back to `open` when the contact writes and no automation owns it. */
  reopenOnInbound: z.boolean().default(true),
  /** Automations are paused this many minutes after a human agent replies (0 = never). */
  pauseAutomationOnAgentReplyMinutes: z.number().int().min(0).max(10_080).default(30),
});
export type InboxSettings = z.infer<typeof inboxSettingsSchema>;

export const patchInboxSettingsRequestSchema = z
  .object({
    autoAssign: z.enum(["off", "round_robin"]),
    maxOpenPerAgent: z.number().int().min(1).max(1000).nullable(),
    visibility: z.enum(["all", "own"]),
    reopenOnInbound: z.boolean(),
    pauseAutomationOnAgentReplyMinutes: z.number().int().min(0).max(10_080),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type PatchInboxSettingsRequest = z.infer<typeof patchInboxSettingsRequestSchema>;

/** Lenient read of stored settings: invalid data falls back to defaults. */
export function resolveInboxSettings(raw: unknown): InboxSettings {
  const parsed = inboxSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : inboxSettingsSchema.parse({});
}

// --- Conversation list ------------------------------------------------------------

export const listInboxConversationsQuerySchema = z.object({
  status: z.enum(["open", "closed", "all"]).default("open"),
  unread: boolParam,
  /** Folder "Recordatorios": conversations with a pending reminder of the current user. */
  reminders: boolParam,
  sort: z.enum(["newest", "oldest"]).default("newest"),
  /** "me", "unassigned" or a user id. */
  assignedTo: z.union([z.literal("me"), z.literal("unassigned"), uuidSchema]).optional(),
  tag: z.string().trim().min(1).max(64).optional(),
  channelConnectionId: uuidSchema.optional(),
  /** Global search: contact name/phone and message bodies (literal, case-insensitive). */
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListInboxConversationsQuery = z.infer<typeof listInboxConversationsQuerySchema>;

export const inboxConversationSchema = conversationSchema.extend({
  inboxStatus: inboxStatusSchema,
  /** unreadCount > 0 or marked unread by an agent. */
  unread: z.boolean(),
  markedUnread: z.boolean(),
  assignedAt: isoDateTimeSchema.nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  contactTags: z.array(z.string()),
  automationsPausedUntil: isoDateTimeSchema.nullable(),
  /** Earliest pending reminder of the current user on this conversation. */
  nextReminderAt: isoDateTimeSchema.nullable(),
});
export type InboxConversation = z.infer<typeof inboxConversationSchema>;

export const inboxConversationListResponseSchema = z.object({
  items: z.array(inboxConversationSchema),
  nextCursor: z.string().nullable(),
});
export type InboxConversationListResponse = z.infer<typeof inboxConversationListResponseSchema>;

/** Folder badges. Every count honours the visibility setting of the caller. */
export const inboxCountsSchema = z.object({
  open: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  /** Unread among open conversations. */
  unread: z.number().int().nonnegative(),
  mine: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative(),
  /** Pending reminders of the current user already due. */
  remindersDue: z.number().int().nonnegative(),
  /** Pending reminders of the current user (due or not). */
  reminders: z.number().int().nonnegative(),
  /** Open conversations per contact tag. */
  tags: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() })),
});
export type InboxCounts = z.infer<typeof inboxCountsSchema>;

// --- Actions ------------------------------------------------------------------------

export const assignConversationRequestSchema = z.object({
  /** "me", a member user id, or null to unassign. */
  assignee: z.union([z.literal("me"), uuidSchema]).nullable(),
});
export type AssignConversationRequest = z.infer<typeof assignConversationRequestSchema>;

export const setInboxStatusRequestSchema = z.object({ status: inboxStatusSchema });
export type SetInboxStatusRequest = z.infer<typeof setInboxStatusRequestSchema>;

// --- Notes ------------------------------------------------------------------------

export const createNoteRequestSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;

export const conversationNoteSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  author: z.object({ id: uuidSchema, name: z.string().nullable(), email: z.string() }).nullable(),
  body: z.string(),
  createdAt: isoDateTimeSchema,
});
export type ConversationNote = z.infer<typeof conversationNoteSchema>;

export const noteListResponseSchema = z.object({ items: z.array(conversationNoteSchema) });
export type NoteListResponse = z.infer<typeof noteListResponseSchema>;

// --- Reminders ----------------------------------------------------------------------

export const reminderPresetSchema = z.enum(["20m", "1h", "6h", "12h", "custom"]);

export const createReminderRequestSchema = z
  .object({
    preset: reminderPresetSchema,
    /** Required with preset "custom". */
    remindAt: isoDateTimeSchema.optional(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.preset !== "custom" || v.remindAt !== undefined, { message: "remindAt is required for custom" });
export type CreateReminderRequest = z.infer<typeof createReminderRequestSchema>;

export const updateReminderRequestSchema = z.object({ done: z.boolean() });
export type UpdateReminderRequest = z.infer<typeof updateReminderRequestSchema>;

export const reminderSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  userId: uuidSchema,
  remindAt: isoDateTimeSchema,
  note: z.string().nullable(),
  done: z.boolean(),
  notifiedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Reminder = z.infer<typeof reminderSchema>;

export const reminderListResponseSchema = z.object({ items: z.array(reminderSchema) });
export type ReminderListResponse = z.infer<typeof reminderListResponseSchema>;

// --- Tags catalog -------------------------------------------------------------------

const tagNameSchema = z.string().trim().min(1).max(64);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const emojiSchema = z.string().trim().min(1).max(16);

export const createTagRequestSchema = z.object({
  name: tagNameSchema,
  emoji: emojiSchema.nullable().optional(),
  color: colorSchema.nullable().optional(),
});
export type CreateTagRequest = z.infer<typeof createTagRequestSchema>;

/** Renaming also rewrites the tag string on every contact (`contacts.tags`). */
export const updateTagRequestSchema = createTagRequestSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateTagRequest = z.infer<typeof updateTagRequestSchema>;

export const tagSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  emoji: z.string().nullable(),
  color: z.string().nullable(),
  contactCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type TagDto = z.infer<typeof tagSchema>;

export const tagListResponseSchema = z.object({ items: z.array(tagSchema) });
export type TagListResponse = z.infer<typeof tagListResponseSchema>;

// --- Canned responses ---------------------------------------------------------------

export const createCannedResponseRequestSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(4096),
  shortcut: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,32}$/)
    .nullable()
    .optional(),
});
export type CreateCannedResponseRequest = z.infer<typeof createCannedResponseRequestSchema>;

export const updateCannedResponseRequestSchema = createCannedResponseRequestSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateCannedResponseRequest = z.infer<typeof updateCannedResponseRequestSchema>;

export const cannedResponseSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  body: z.string(),
  shortcut: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CannedResponseDto = z.infer<typeof cannedResponseSchema>;

export const cannedResponseListResponseSchema = z.object({ items: z.array(cannedResponseSchema) });
export type CannedResponseListResponse = z.infer<typeof cannedResponseListResponseSchema>;

export const listCannedResponsesQuerySchema = z.object({ q: z.string().trim().min(1).max(100).optional() });

// --- Contact panel / automation pause -------------------------------------------------

/** minutes = null resumes automations now. */
export const pauseAutomationsRequestSchema = z.object({
  minutes: z.number().int().min(1).max(525_600).nullable(),
});
export type PauseAutomationsRequest = z.infer<typeof pauseAutomationsRequestSchema>;

export const leadOriginSchema = z.enum(["ad", "whatsapp", "manual"]);
export type LeadOrigin = z.infer<typeof leadOriginSchema>;

export const contactPanelSchema = z.object({
  contactId: uuidSchema,
  /** ad = click-to-WhatsApp attribution; whatsapp = first inbound message; manual = created by hand/import/api. */
  origin: leadOriginSchema,
  ad: z
    .object({
      sourceId: z.string().nullable(),
      sourceType: z.string().nullable(),
      sourceUrl: z.string().nullable(),
      headline: z.string().nullable(),
      firstSeenAt: isoDateTimeSchema,
    })
    .nullable(),
  country: z.string().nullable(),
  /** IANA timezone derived from the phone country when unambiguous. */
  timezone: z.string().nullable(),
  firstContactAt: isoDateTimeSchema,
  firstInboundAt: isoDateTimeSchema.nullable(),
  automationsPausedUntil: isoDateTimeSchema.nullable(),
  tags: z.array(z.object({ name: z.string(), emoji: z.string().nullable(), color: z.string().nullable() })),
});
export type ContactPanel = z.infer<typeof contactPanelSchema>;
