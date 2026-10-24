import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

/**
 * Support tickets (ADR 0016). Tenant members open tickets; platform admins answer them from the
 * backoffice. Internal notes (`internal: true`) are never returned by tenant routes.
 */

export const SUPPORT_TICKET_STATUSES = ["open", "in_progress", "waiting_customer", "resolved"] as const;
export const supportTicketStatusSchema = z.enum(SUPPORT_TICKET_STATUSES);
export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

export const SUPPORT_TICKET_CATEGORIES = ["billing", "whatsapp", "ai", "bug", "other"] as const;
export const supportTicketCategorySchema = z.enum(SUPPORT_TICKET_CATEGORIES);
export type SupportTicketCategory = z.infer<typeof supportTicketCategorySchema>;

export const SUPPORT_TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const supportTicketPrioritySchema = z.enum(SUPPORT_TICKET_PRIORITIES);
export type SupportTicketPriority = z.infer<typeof supportTicketPrioritySchema>;

export const supportAuthorTypeSchema = z.enum(["tenant_user", "platform_admin"]);
export type SupportAuthorType = z.infer<typeof supportAuthorTypeSchema>;

export const SUPPORT_SUBJECT_MAX = 160;
export const SUPPORT_BODY_MAX = 5000;

const subjectSchema = z.string().trim().min(3).max(SUPPORT_SUBJECT_MAX);
const bodySchema = z.string().trim().min(1).max(SUPPORT_BODY_MAX);

// --- Tickets ---------------------------------------------------------------------

export const supportTicketSchema = z.object({
  id: uuidSchema,
  number: z.number().int().positive(),
  subject: z.string(),
  category: supportTicketCategorySchema,
  priority: supportTicketPrioritySchema,
  status: supportTicketStatusSchema,
  createdBy: z.object({ id: uuidSchema.nullable(), name: z.string().nullable(), email: z.string().nullable() }),
  /** Platform admin handling the ticket (name only on tenant routes). */
  assignee: z.object({ id: uuidSchema.nullable(), name: z.string().nullable() }).nullable(),
  /** True when there is a public admin reply the tenant has not opened yet. */
  unread: z.boolean(),
  lastMessageAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
});
export type SupportTicket = z.infer<typeof supportTicketSchema>;
export const supportTicketListSchema = z.object({ items: z.array(supportTicketSchema) });
export type SupportTicketList = z.infer<typeof supportTicketListSchema>;

export const supportMessageSchema = z.object({
  id: uuidSchema,
  authorType: supportAuthorTypeSchema,
  authorName: z.string().nullable(),
  body: z.string(),
  internal: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type SupportMessage = z.infer<typeof supportMessageSchema>;

export const supportTicketThreadSchema = z.object({
  ticket: supportTicketSchema,
  messages: z.array(supportMessageSchema),
});
export type SupportTicketThread = z.infer<typeof supportTicketThreadSchema>;

export const createSupportTicketRequestSchema = z.object({
  subject: subjectSchema,
  category: supportTicketCategorySchema,
  priority: supportTicketPrioritySchema.default("normal"),
  message: bodySchema,
});
export type CreateSupportTicketRequest = z.input<typeof createSupportTicketRequestSchema>;

export const supportReplyRequestSchema = z.object({ body: bodySchema });
export type SupportReplyRequest = z.infer<typeof supportReplyRequestSchema>;

export const supportTicketListQuerySchema = z.object({
  status: supportTicketStatusSchema.optional(),
});
export type SupportTicketListQuery = z.infer<typeof supportTicketListQuerySchema>;

export const supportUnreadSchema = z.object({ unreadCount: z.number().int().nonnegative() });
export type SupportUnread = z.infer<typeof supportUnreadSchema>;

// --- Platform (backoffice) -------------------------------------------------------

export const platformSupportTicketSchema = supportTicketSchema.extend({
  tenant: z.object({ id: uuidSchema, name: z.string() }),
  /** True when the tenant wrote something no admin has opened yet. */
  adminUnread: z.boolean(),
});
export type PlatformSupportTicket = z.infer<typeof platformSupportTicketSchema>;
export const platformSupportTicketListSchema = z.object({ items: z.array(platformSupportTicketSchema) });
export type PlatformSupportTicketList = z.infer<typeof platformSupportTicketListSchema>;

export const platformSupportThreadSchema = z.object({
  ticket: platformSupportTicketSchema,
  messages: z.array(supportMessageSchema),
});
export type PlatformSupportThread = z.infer<typeof platformSupportThreadSchema>;

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

export const platformSupportListQuerySchema = z.object({
  status: z.preprocess(emptyToUndefined, supportTicketStatusSchema.optional()),
  priority: z.preprocess(emptyToUndefined, supportTicketPrioritySchema.optional()),
  category: z.preprocess(emptyToUndefined, supportTicketCategorySchema.optional()),
  tenantId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  /** "me" = assigned to the caller, "none" = unassigned. */
  assigned: z.preprocess(emptyToUndefined, z.enum(["me", "none"]).optional()),
});
export type PlatformSupportListQuery = z.infer<typeof platformSupportListQuerySchema>;

export const platformSupportReplyRequestSchema = z.object({
  body: bodySchema,
  /** Internal note: visible only to platform admins. */
  internal: z.boolean().default(false),
});
export type PlatformSupportReplyRequest = z.input<typeof platformSupportReplyRequestSchema>;

export const platformSupportUpdateRequestSchema = z
  .object({
    status: supportTicketStatusSchema.optional(),
    priority: supportTicketPrioritySchema.optional(),
    /** true = assign to the caller, false = unassign. */
    assignToMe: z.boolean().optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined || v.assignToMe !== undefined, { message: "Nothing to update" });
export type PlatformSupportUpdateRequest = z.infer<typeof platformSupportUpdateRequestSchema>;

export const supportCannedResponseSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  body: z.string(),
  updatedAt: isoDateTimeSchema,
});
export type SupportCannedResponse = z.infer<typeof supportCannedResponseSchema>;
export const supportCannedResponseListSchema = z.object({ items: z.array(supportCannedResponseSchema) });

export const upsertSupportCannedResponseRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(SUPPORT_BODY_MAX),
});
export type UpsertSupportCannedResponseRequest = z.infer<typeof upsertSupportCannedResponseRequestSchema>;

/** Variables a canned response may use; anything else is left as written. */
export const SUPPORT_CANNED_VARIABLES = ["nombre", "negocio", "ticket", "asunto"] as const;
export type SupportCannedVariable = (typeof SUPPORT_CANNED_VARIABLES)[number];

// --- Realtime ----------------------------------------------------------------------

/** SSE event on the tenant channel and on the platform support channel; ids only. */
export const supportEventSchema = z.object({
  type: z.literal("support.ticket_updated"),
  ticketId: uuidSchema,
});
export type SupportEvent = z.infer<typeof supportEventSchema>;
