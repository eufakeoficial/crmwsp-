import { z } from "zod";

/*
 * AI runs ("Ejecuciones") and the human-attention queue ("Necesitan atención").
 * Both are read models over `ai_actions`: a run is one reply/draft/handoff decision of the
 * AI worker. Token and cost figures live in `usage_ledger` per conversation, not per action,
 * so they are intentionally not part of a run.
 */

export const AI_RUN_OUTCOMES = ["sent", "draft", "handoff", "blocked", "error"] as const;
export const aiRunOutcomeSchema = z.enum(AI_RUN_OUTCOMES);
export type AiRunOutcome = z.infer<typeof aiRunOutcomeSchema>;

export const AI_RUN_MODES = ["auto", "draft"] as const;
export const aiRunModeSchema = z.enum(AI_RUN_MODES);
export type AiRunMode = z.infer<typeof aiRunModeSchema>;

export const aiRunsQuerySchema = z.object({
  outcome: aiRunOutcomeSchema.optional(),
  mode: aiRunModeSchema.optional(),
  conversationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(500).optional(),
});
export type AiRunsQuery = z.infer<typeof aiRunsQuerySchema>;

export const aiRunCitationSchema = z.object({
  chunkId: z.string(),
  sourceId: z.string().optional(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
});
export type AiRunCitation = z.infer<typeof aiRunCitationSchema>;

export const aiRunItemSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  conversationId: z.string().nullable(),
  contactName: z.string().nullable(),
  /** `auto` = sent by the AI on its own, `draft` = left for a human; null for handoffs. */
  mode: aiRunModeSchema.nullable(),
  outcome: aiRunOutcomeSchema,
  /** Machine reason (policy reason or handoff code such as `budget_exceeded`). */
  reason: z.string().nullable(),
  model: z.string().nullable(),
  confidence: z.number().nullable(),
  /** Reply text (truncated); null for handoffs. */
  text: z.string().nullable(),
  citations: z.array(aiRunCitationSchema),
});
export type AiRunItem = z.infer<typeof aiRunItemSchema>;

export const aiRunListSchema = z.object({ items: z.array(aiRunItemSchema), nextCursor: z.string().nullable() });
export type AiRunList = z.infer<typeof aiRunListSchema>;

export const aiHandoffsQuerySchema = z.object({
  assignedTo: z.enum(["me", "unassigned"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(500).optional(),
});
export type AiHandoffsQuery = z.infer<typeof aiHandoffsQuerySchema>;

export const aiHandoffItemSchema = z.object({
  /** Id of the handoff `ai_actions` row. */
  id: z.string(),
  conversationId: z.string(),
  contactName: z.string().nullable(),
  contactPhone: z.string(),
  reason: z.string().nullable(),
  /** When the AI handed the conversation off; the wait is counted from here. */
  handedOffAt: z.string(),
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
});
export type AiHandoffItem = z.infer<typeof aiHandoffItemSchema>;

export const aiHandoffListSchema = z.object({ items: z.array(aiHandoffItemSchema), nextCursor: z.string().nullable() });
export type AiHandoffList = z.infer<typeof aiHandoffListSchema>;
