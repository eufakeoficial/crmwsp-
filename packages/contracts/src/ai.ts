import { z } from "zod";

/*
 * AI turn contract (ADR 0003: the AI proposes, the system executes).
 * Every object is `strict`: extra fields coming from the model are rejected, never
 * silently dropped, so a model cannot smuggle unexpected parameters into an action.
 */

export const AI_CLAIM_KINDS = ["price", "stock", "lead_time", "policy", "other"] as const;
export const aiClaimKindSchema = z.enum(AI_CLAIM_KINDS);
export type AiClaimKind = z.infer<typeof aiClaimKindSchema>;

/** Claim kinds that must always be backed by a valid knowledge chunk citation. */
export const FACTUAL_CLAIM_KINDS: readonly AiClaimKind[] = ["price", "stock", "lead_time", "policy"];

const idSchema = z.string().min(1).max(200);
const confidenceSchema = z.number().min(0).max(1);

export const aiCitationSchema = z.strictObject({ chunkId: idSchema });
export type AiCitation = z.infer<typeof aiCitationSchema>;

export const aiClaimSchema = z.strictObject({
  kind: aiClaimKindSchema,
  text: z.string().min(1).max(1000),
  citations: z.array(aiCitationSchema).max(20),
});
export type AiClaim = z.infer<typeof aiClaimSchema>;

export const aiReplySchema = z.strictObject({
  text: z.string().min(1).max(4096),
  claims: z.array(aiClaimSchema).max(50),
});
export type AiReply = z.infer<typeof aiReplySchema>;

export const updateContactFieldActionSchema = z.strictObject({
  type: z.literal("update_contact_field"),
  field: z.string().min(1).max(100),
  value: z.string().max(1000),
  confidence: confidenceSchema,
  sourceMessageId: idSchema,
});
export const createTaskActionSchema = z.strictObject({
  type: z.literal("create_task"),
  title: z.string().min(1).max(300),
  dueAt: z.iso.datetime({ offset: true }).optional(),
});
export const moveStageActionSchema = z.strictObject({
  type: z.literal("move_stage"),
  stage: z.string().min(1).max(100),
});
export const createQuoteDraftActionSchema = z.strictObject({
  type: z.literal("create_quote_draft"),
  items: z
    .array(z.strictObject({ chunkId: idSchema, quantity: z.number().positive().max(1_000_000) }))
    .min(1)
    .max(100),
});
export const applyDiscountActionSchema = z.strictObject({
  type: z.literal("apply_discount"),
  // Range is enforced by the policy engine (deny), not here, so out-of-range requests are audited.
  percent: z.number(),
});
export const sendTemplateActionSchema = z.strictObject({
  type: z.literal("send_template"),
  templateName: z.string().min(1).max(512),
});
export const handoffActionSchema = z.strictObject({
  type: z.literal("handoff"),
  reason: z.string().min(1).max(1000),
});

export const aiActionSchema = z.discriminatedUnion("type", [
  updateContactFieldActionSchema,
  createTaskActionSchema,
  moveStageActionSchema,
  createQuoteDraftActionSchema,
  applyDiscountActionSchema,
  sendTemplateActionSchema,
  handoffActionSchema,
]);
export type AiAction = z.infer<typeof aiActionSchema>;
export type AiActionType = AiAction["type"];
export const AI_ACTION_TYPES = [
  "update_contact_field",
  "create_task",
  "move_stage",
  "create_quote_draft",
  "apply_discount",
  "send_template",
  "handoff",
] as const satisfies readonly AiActionType[];

/** Emojis the assistant (or an agent) may use to react to a message. Anything else is dropped. */
export const REACTION_EMOJIS = ["👍", "❤️", "😊", "🙌", "🎉", "🙏", "😂"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
export const reactionEmojiSchema = z.enum(REACTION_EMOJIS);
/** Drops variation selectors differences ("❤" vs "❤️") and returns the allowed emoji, or null. */
export function normalizeReactionEmoji(raw: unknown): ReactionEmoji | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  const found = REACTION_EMOJIS.find((e) => e === t || e.replace(/️/g, "") === t.replace(/️/g, ""));
  return found ?? null;
}

export const aiTurnOutputSchema = z.strictObject({
  reply: aiReplySchema.optional(),
  /** Optional emoji reaction to the customer's message (validated against REACTION_EMOJIS server-side). */
  reaction: z.strictObject({ emoji: z.string().max(32) }).optional(),
  actions: z.array(aiActionSchema).max(20),
  confidence: confidenceSchema,
  needsHuman: z.boolean(),
  reason: z.string().max(2000),
});
export type AiTurnOutput = z.infer<typeof aiTurnOutputSchema>;

export const aiDecisionSchema = z.enum(["auto", "approve", "deny"]);
export type AiDecision = z.infer<typeof aiDecisionSchema>;
