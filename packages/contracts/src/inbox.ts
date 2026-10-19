import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";
import { ErrorCode } from "./errors.js";

export const conversationStatusSchema = z.enum(["open", "pending", "resolved"]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const aiModeSchema = z.enum(["auto", "assist", "off"]);
export type AiMode = z.infer<typeof aiModeSchema>;

export const messageDirectionSchema = z.enum(["inbound", "outbound"]);
export const messageTypeSchema = z.enum([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "location",
  "template",
  "interactive",
  "unsupported",
]);
export const messageStatusSchema = z.enum(["received", "queued", "sent", "delivered", "read", "failed"]);
export const messageAuthorSchema = z.enum(["contact", "user", "ai", "system"]);

/** Max characters of the last-message preview in the conversation list. */
export const MESSAGE_PREVIEW_MAX = 120;

/** Error code returned (422) when sending free text outside the 24 h customer service window. */
export const OUTSIDE_SERVICE_WINDOW = ErrorCode.OutsideServiceWindow;
export { OutsideServiceWindowError } from "./errors.js";

/** WhatsApp customer service window. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const limitSchema = (def: number) => z.coerce.number().int().min(1).max(100).default(def);

// --- Contacts -----------------------------------------------------------------

export const contactSummarySchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  phoneE164: z.string(),
});
export type ContactSummary = z.infer<typeof contactSummarySchema>;

/**
 * One AI-extracted fact about a contact. The DB column is free-form jsonb, so unknown
 * keys are kept (looseObject) and only `value` is required.
 */
export const extractedFieldSchema = z.looseObject({
  value: z.unknown(),
  confidence: z.number().min(0).max(1).optional(),
  sourceMessageId: uuidSchema.optional(),
});
export type ExtractedField = z.infer<typeof extractedFieldSchema>;

/** Extracted facts keyed by field name; tolerant of legacy/free-form entries. */
export const contactExtractedSchema = z.record(z.string(), z.unknown());
export type ContactExtracted = z.infer<typeof contactExtractedSchema>;

export const contactSchema = contactSummarySchema.extend({
  tags: z.array(z.string()),
  extracted: contactExtractedSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Contact = z.infer<typeof contactSchema>;

export const listContactsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: limitSchema(25),
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

export const contactListResponseSchema = z.object({ items: z.array(contactSchema) });
export type ContactListResponse = z.infer<typeof contactListResponseSchema>;

// --- Messages -----------------------------------------------------------------

export const attachmentSchema = z.object({
  id: uuidSchema,
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  storageKey: z.string().nullable(),
  transcript: z.string().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const messageSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  direction: messageDirectionSchema,
  type: messageTypeSchema,
  body: z.string().nullable(),
  status: messageStatusSchema,
  author: messageAuthorSchema,
  authorUserId: uuidSchema.nullable(),
  clientMessageId: uuidSchema.nullable(),
  /** Sanitised delivery error ({ code?, message? }) when status = failed. */
  error: z.record(z.string(), z.unknown()).nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  attachments: z.array(attachmentSchema),
});
export type Message = z.infer<typeof messageSchema>;

export const listMessagesQuerySchema = z.object({
  /** Opaque cursor (nextCursor of the previous page): returns older messages. */
  before: z.string().min(1).max(200).optional(),
  limit: limitSchema(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

/** Messages newest first; nextCursor pages backwards in time. */
export const messageListResponseSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;

export const sendMessageRequestSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  clientMessageId: uuidSchema,
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

// --- Conversations ------------------------------------------------------------

export const listConversationsQuerySchema = z.object({
  status: conversationStatusSchema.optional(),
  /** "me", "unassigned" or a user id. */
  assignedTo: z.union([z.literal("me"), z.literal("unassigned"), uuidSchema]).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: limitSchema(25),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const lastMessagePreviewSchema = z.object({
  id: uuidSchema,
  direction: messageDirectionSchema,
  type: messageTypeSchema,
  status: messageStatusSchema,
  /** Body truncated to MESSAGE_PREVIEW_MAX characters. */
  preview: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type LastMessagePreview = z.infer<typeof lastMessagePreviewSchema>;

export const assigneeSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  email: z.string(),
});
export type Assignee = z.infer<typeof assigneeSchema>;

export const conversationSchema = z.object({
  id: uuidSchema,
  status: conversationStatusSchema,
  aiMode: aiModeSchema,
  channelConnectionId: uuidSchema,
  contact: contactSummarySchema,
  assignee: assigneeSchema.nullable(),
  lastMessage: lastMessagePreviewSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  lastInboundAt: isoDateTimeSchema.nullable(),
  lastMessageAt: isoDateTimeSchema.nullable(),
  lastReadAt: isoDateTimeSchema.nullable(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationListResponseSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

/**
 * PATCH /conversations/:id. lockVersion (or the If-Match header) is required for
 * optimistic concurrency: a stale value answers 409.
 */
export const updateConversationRequestSchema = z
  .object({
    status: conversationStatusSchema.optional(),
    assignedUserId: uuidSchema.nullable().optional(),
    aiMode: aiModeSchema.optional(),
    lockVersion: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.status !== undefined || v.assignedUserId !== undefined || v.aiMode !== undefined, {
    message: "Nothing to update",
  });
export type UpdateConversationRequest = z.infer<typeof updateConversationRequestSchema>;

// --- Realtime (SSE /events) ---------------------------------------------------

export const inboxEventSchema = z.object({
  type: z.enum(["message.received", "message.created", "message.status", "conversation.updated"]),
  conversationId: uuidSchema,
  messageId: uuidSchema.optional(),
});
export type InboxEvent = z.infer<typeof inboxEventSchema>;
