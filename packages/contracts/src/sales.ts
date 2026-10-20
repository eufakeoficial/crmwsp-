import { z } from "zod";
import { currencySchema, isoDateTimeSchema, uuidSchema } from "./common.js";

/** Money is always integer minor units + ISO currency; quote quantities are thousandths (`quantityMilli`). */

export const stageKindSchema = z.enum(["open", "won", "lost"]);
export type StageKind = z.infer<typeof stageKindSchema>;

export const stageSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string(),
  position: z.number().int(),
  kind: stageKindSchema,
});
export type Stage = z.infer<typeof stageSchema>;

export const pipelineSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isDefault: z.boolean(),
  stages: z.array(stageSchema),
});
export type Pipeline = z.infer<typeof pipelineSchema>;
export const pipelineListSchema = z.object({ items: z.array(pipelineSchema) });
export type PipelineList = z.infer<typeof pipelineListSchema>;

export const quoteStatusSchema = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
]);
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

export const actorTypeSchema = z.enum(["user", "ai", "system"]);

export const userRefSchema = z.object({ id: uuidSchema, name: z.string() });
export type UserRef = z.infer<typeof userRefSchema>;

export const contactRefSchema = z.object({ id: uuidSchema, name: z.string().nullable(), phoneE164: z.string() });

// --- Tasks ---------------------------------------------------------------------

export const taskStatusSchema = z.enum(["open", "done", "cancelled"]);
export const taskSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  status: taskStatusSchema,
  dueAt: isoDateTimeSchema.nullable(),
  assignedUser: userRefSchema.nullable(),
  opportunityId: uuidSchema.nullable(),
  contactName: z.string().nullable(),
  createdByType: actorTypeSchema,
});
export type Task = z.infer<typeof taskSchema>;
export const taskListSchema = z.object({ items: z.array(taskSchema) });

export const listTasksQuerySchema = z.object({
  status: z.enum(["open", "done", "cancelled"]).optional(),
  assignedTo: z.enum(["me", "all"]).optional(),
  due: z.enum(["overdue", "today", "week"]).optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const createTaskRequestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  dueAt: isoDateTimeSchema.optional(),
  assignedUserId: uuidSchema.optional(),
  opportunityId: uuidSchema.optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const patchTaskRequestSchema = z
  .object({
    status: taskStatusSchema.optional(),
    title: z.string().trim().min(1).max(300).optional(),
    dueAt: isoDateTimeSchema.nullable().optional(),
    assignedUserId: uuidSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type PatchTaskRequest = z.infer<typeof patchTaskRequestSchema>;

// --- Opportunities ---------------------------------------------------------------

export const opportunitySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  contact: contactRefSchema,
  pipelineId: uuidSchema,
  stageId: uuidSchema,
  valueMinor: z.number().int().nullable(),
  currency: currencySchema,
  owner: userRefSchema.nullable(),
  nextActionAt: isoDateTimeSchema.nullable(),
  lostReason: z.string().nullable(),
  wonAt: isoDateTimeSchema.nullable(),
  lostAt: isoDateTimeSchema.nullable(),
  lastQuote: z
    .object({ id: uuidSchema, number: z.string(), status: quoteStatusSchema, totalMinor: z.number().int() })
    .nullable(),
  updatedAt: isoDateTimeSchema,
  lockVersion: z.number().int(),
});
export type Opportunity = z.infer<typeof opportunitySchema>;
export const opportunityListSchema = z.object({ items: z.array(opportunitySchema), nextCursor: z.string().nullable() });
export type OpportunityList = z.infer<typeof opportunityListSchema>;

export const stageHistorySchema = z.object({
  id: uuidSchema,
  fromStageId: uuidSchema.nullable(),
  toStageId: uuidSchema,
  at: isoDateTimeSchema,
  actor: z.object({ type: actorTypeSchema, name: z.string().nullable() }),
  lostReason: z.string().nullable(),
});
export type StageHistoryEntry = z.infer<typeof stageHistorySchema>;

export const opportunityDetailSchema = opportunitySchema.extend({
  conversationId: uuidSchema.nullable(),
  history: z.array(stageHistorySchema),
  quotes: z.array(
    z.object({ id: uuidSchema, number: z.string(), status: quoteStatusSchema, totalMinor: z.number().int(), currency: currencySchema }),
  ),
  orders: z.array(
    z.object({ id: uuidSchema, number: z.string(), status: z.string(), totalMinor: z.number().int(), currency: currencySchema }),
  ),
  tasks: z.array(taskSchema),
});
export type OpportunityDetail = z.infer<typeof opportunityDetailSchema>;

export const listOpportunitiesQuerySchema = z.object({
  pipelineId: uuidSchema.optional(),
  stageId: uuidSchema.optional(),
  /** A user id or "me". */
  ownerId: z.union([z.literal("me"), uuidSchema]).optional(),
  contactId: uuidSchema.optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListOpportunitiesQuery = z.infer<typeof listOpportunitiesQuerySchema>;

const minorSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const createOpportunityRequestSchema = z.object({
  contactId: uuidSchema,
  title: z.string().trim().min(1).max(200),
  valueMinor: minorSchema.optional(),
  currency: currencySchema,
  stageId: uuidSchema.optional(),
});
export type CreateOpportunityRequest = z.infer<typeof createOpportunityRequestSchema>;

export const patchOpportunityRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  valueMinor: minorSchema.nullable().optional(),
  ownerId: uuidSchema.nullable().optional(),
  nextActionAt: isoDateTimeSchema.nullable().optional(),
  lockVersion: z.number().int().min(0),
});
export type PatchOpportunityRequest = z.infer<typeof patchOpportunityRequestSchema>;

export const moveOpportunityRequestSchema = z.object({
  stageId: uuidSchema,
  lostReason: z.string().trim().min(1).max(500).optional(),
  lockVersion: z.number().int().min(0),
});
export type MoveOpportunityRequest = z.infer<typeof moveOpportunityRequestSchema>;

// --- Quotes ----------------------------------------------------------------------

/** Max sizes keep every sum safe and match what the PDF renderer accepts (quantity <= 1000). */
export const QUOTE_MAX_QUANTITY_MILLI = 1_000_000;
export const QUOTE_MAX_UNIT_PRICE_MINOR = 1_000_000_000;

export const quoteItemSchema = z.object({
  id: uuidSchema,
  description: z.string(),
  quantityMilli: z.number().int(),
  unit: z.string(),
  unitPriceMinor: z.number().int(),
  discountBp: z.number().int(),
  taxRateBp: z.number().int(),
  lineTotalMinor: z.number().int(),
  productId: uuidSchema.nullable(),
  knowledgeChunkId: uuidSchema.nullable(),
  /** Available units of the product (sum of its tracked variants); null when not tracked or free line. */
  stock: z.number().int().nullable(),
});
export type QuoteItem = z.infer<typeof quoteItemSchema>;

export const quoteSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: quoteStatusSchema,
  currency: currencySchema,
  items: z.array(quoteItemSchema),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  validUntil: isoDateTimeSchema,
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  contact: contactRefSchema,
  opportunityId: uuidSchema.nullable(),
  conversationId: uuidSchema.nullable(),
  /** Relative API path of the PDF (`/quotes/:id/pdf`). */
  pdfUrl: z.string().nullable(),
  createdByType: z.enum(["user", "ai", "system"]),
  approvalRequired: z.boolean(),
  sentAt: isoDateTimeSchema.nullable(),
  acceptedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  lockVersion: z.number().int(),
});
export type Quote = z.infer<typeof quoteSchema>;
export const quoteListSchema = z.object({ items: z.array(quoteSchema) });
export type QuoteList = z.infer<typeof quoteListSchema>;

export const listQuotesQuerySchema = z.object({
  status: quoteStatusSchema.optional(),
  opportunityId: uuidSchema.optional(),
});
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;

export const quoteItemInputSchema = z
  .object({
    productId: uuidSchema.optional(),
    variantId: uuidSchema.optional(),
    description: z.string().trim().min(1).max(1000).optional(),
    quantityMilli: z.number().int().min(1).max(QUOTE_MAX_QUANTITY_MILLI),
    /** Free lines, or owner/admin overriding a catalog price (audited). Ignored for other roles on catalog lines. */
    unitPriceMinor: z.number().int().min(0).max(QUOTE_MAX_UNIT_PRICE_MINOR).optional(),
    discountBp: z.number().int().min(0).max(10_000).optional(),
    /** Free lines only; catalog lines use the product's tax rate. */
    taxRateBp: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((i) => i.productId !== undefined || i.variantId !== undefined || (i.description !== undefined && i.unitPriceMinor !== undefined), {
    message: "Free lines need description and unitPriceMinor",
  });
export type QuoteItemInput = z.infer<typeof quoteItemInputSchema>;

/** A calendar date (`YYYY-MM-DD`, end of that day UTC) or a full ISO datetime. */
const validUntilSchema = z.union([
  isoDateTimeSchema,
  z.iso.date().transform((d) => `${d}T23:59:59.999Z`),
]);

export const createQuoteRequestSchema = z.object({
  opportunityId: uuidSchema.optional(),
  contactId: uuidSchema,
  conversationId: uuidSchema.optional(),
  currency: currencySchema,
  validUntil: validUntilSchema,
  items: z.array(quoteItemInputSchema).min(1).max(100),
  notes: z.string().trim().max(5000).optional(),
  terms: z.string().trim().max(5000).optional(),
});
export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

export const patchQuoteRequestSchema = z.object({
  opportunityId: uuidSchema.nullable().optional(),
  contactId: uuidSchema.optional(),
  currency: currencySchema.optional(),
  validUntil: validUntilSchema.optional(),
  items: z.array(quoteItemInputSchema).min(1).max(100).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  terms: z.string().trim().max(5000).nullable().optional(),
  lockVersion: z.number().int().min(0),
});
export type PatchQuoteRequest = z.infer<typeof patchQuoteRequestSchema>;

/** Public acceptance page: no internal ids or contact data. */
export const publicQuoteSchema = z.object({
  number: z.string(),
  status: quoteStatusSchema,
  seller: z.string(),
  currency: currencySchema,
  items: z.array(
    z.object({
      description: z.string(),
      quantityMilli: z.number().int(),
      unit: z.string(),
      unitPriceMinor: z.number().int(),
      discountBp: z.number().int(),
      lineTotalMinor: z.number().int(),
    }),
  ),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  validUntil: isoDateTimeSchema,
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  canAccept: z.boolean(),
});
export type PublicQuote = z.infer<typeof publicQuoteSchema>;
