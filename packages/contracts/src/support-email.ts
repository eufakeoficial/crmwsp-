import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";
import { supportTicketPrioritySchema, supportTicketStatusSchema } from "./support.js";

/**
 * Platform email inbox for contacto@vendemas.chat (ADR 0020), built on support tickets with
 * channel = 'email'. Only platform admins reach these routes.
 */

export const SUPPORT_EMAIL_FOLDERS = ["inbox", "mine", "resolved", "sent"] as const;
export const supportEmailFolderSchema = z.enum(SUPPORT_EMAIL_FOLDERS);
export type SupportEmailFolder = z.infer<typeof supportEmailFolderSchema>;

export const supportEmailListQuerySchema = z.object({ folder: supportEmailFolderSchema.default("inbox") });
export type SupportEmailListQuery = z.infer<typeof supportEmailListQuerySchema>;

export const supportEmailThreadSummarySchema = z.object({
  id: uuidSchema,
  number: z.number().int().positive(),
  subject: z.string(),
  status: supportTicketStatusSchema,
  priority: supportTicketPrioritySchema,
  contactEmail: z.string().nullable(),
  contactName: z.string().nullable(),
  /** Null for external senders that match no user. */
  tenant: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  assignee: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  snippet: z.string(),
  unread: z.boolean(),
  lastMessageAt: isoDateTimeSchema,
});
export type SupportEmailThreadSummary = z.infer<typeof supportEmailThreadSummarySchema>;
export const supportEmailThreadListSchema = z.object({ items: z.array(supportEmailThreadSummarySchema) });
export type SupportEmailThreadList = z.infer<typeof supportEmailThreadListSchema>;

export const supportEmailAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative().nullable(),
});
export type SupportEmailAttachment = z.infer<typeof supportEmailAttachmentSchema>;

export const supportEmailMessageSchema = z.object({
  id: uuidSchema,
  direction: z.enum(["inbound", "outbound", "note"]),
  authorName: z.string().nullable(),
  fromEmail: z.string().nullable(),
  toEmails: z.array(z.string()),
  body: z.string(),
  /** Sanitized server-side; the UI still renders it in a sandboxed iframe. */
  html: z.string().nullable(),
  attachments: z.array(supportEmailAttachmentSchema),
  autoReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type SupportEmailMessage = z.infer<typeof supportEmailMessageSchema>;

export const supportEmailThreadSchema = z.object({
  thread: supportEmailThreadSummarySchema,
  messages: z.array(supportEmailMessageSchema),
});
export type SupportEmailThread = z.infer<typeof supportEmailThreadSchema>;

export const SUPPORT_EMAIL_BODY_MAX = 20_000;

export const supportEmailReplyRequestSchema = z.object({
  body: z.string().trim().min(1).max(SUPPORT_EMAIL_BODY_MAX),
});
export type SupportEmailReplyRequest = z.infer<typeof supportEmailReplyRequestSchema>;

export const supportEmailComposeRequestSchema = z.object({
  to: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  subject: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(SUPPORT_EMAIL_BODY_MAX),
});
export type SupportEmailComposeRequest = z.infer<typeof supportEmailComposeRequestSchema>;

export const supportEmailUnreadSchema = z.object({ unreadCount: z.number().int().nonnegative() });
export type SupportEmailUnread = z.infer<typeof supportEmailUnreadSchema>;
