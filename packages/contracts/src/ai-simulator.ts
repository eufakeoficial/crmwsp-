import { z } from "zod";
import { AI_CLAIM_KINDS } from "./ai.js";

/*
 * F6 conversation simulator. `POST /ai/simulate` runs ONE dry-run AI turn (model + retrieval +
 * policy engine) over a fake conversation and returns what the bot WOULD do. It never sends,
 * enqueues or writes business data; only usage (kind `simulation`) and the plan's ai_messages
 * counter are booked, because the tokens are really spent.
 */

export const SIMULATION_MAX_MESSAGES = 20;
export const SIMULATION_MAX_TEXT = 2_000;
export const DRAFT_PROMPT_MAX = 8_000;

export const simulationMessageSchema = z.strictObject({
  author: z.enum(["contact", "ai"]),
  text: z.string().trim().min(1).max(SIMULATION_MAX_TEXT),
});
export type SimulationMessage = z.infer<typeof simulationMessageSchema>;

export const simulateRequestSchema = z.strictObject({
  messages: z
    .array(simulationMessageSchema)
    .min(1)
    .max(SIMULATION_MAX_MESSAGES)
    .refine((m) => m[m.length - 1]?.author === "contact", { message: "the last message must come from the customer" }),
  /** Unsaved prompt to compare against the active agent config; omitted = active config. */
  draftSystemPrompt: z.string().max(DRAFT_PROMPT_MAX).optional(),
});
export type SimulateRequest = z.infer<typeof simulateRequestSchema>;

/** Policy verdict in owner-facing terms: auto (would run), needs_approval, blocked. */
export const SIMULATION_VERDICTS = ["auto", "needs_approval", "blocked"] as const;
export const simulationVerdictSchema = z.enum(SIMULATION_VERDICTS);
export type SimulationVerdict = z.infer<typeof simulationVerdictSchema>;

export const simulationCitationSchema = z.object({
  chunkId: z.string(),
  /** Whether the chunk was among the retrieved (citable) chunks. Invalid citations are blocked. */
  valid: z.boolean(),
  sourceTitle: z.string().nullable(),
  excerpt: z.string().nullable(),
});
export type SimulationCitation = z.infer<typeof simulationCitationSchema>;

export const simulationClaimSchema = z.object({
  kind: z.enum(AI_CLAIM_KINDS),
  text: z.string(),
  citations: z.array(simulationCitationSchema),
});

export const simulationActionSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  verdict: simulationVerdictSchema,
  reason: z.string(),
  /** Added by the policy engine (e.g. handoff after a refused reply), not proposed by the model. */
  addedByPolicy: z.boolean(),
});
export type SimulationAction = z.infer<typeof simulationActionSchema>;

export const simulationResultSchema = z.object({
  promptSource: z.enum(["active", "draft"]),
  model: z.string(),
  reply: z
    .object({
      text: z.string(),
      /** `send` = would be sent automatically; `draft` = left for a human; `blocked` = refused. */
      outcome: z.enum(["send", "draft", "blocked"]),
      reason: z.string(),
      claims: z.array(simulationClaimSchema),
    })
    .nullable(),
  actions: z.array(simulationActionSchema),
  handoff: z.boolean(),
  confidence: z.number(),
  confidenceThreshold: z.number(),
  needsHuman: z.boolean(),
  modelReason: z.string(),
  retrievedChunks: z.number().int().nonnegative(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    embeddingTokens: z.number().int().nonnegative(),
    /** Estimated cost in USD (from the static price table; `priceKnown=false` = model not priced). */
    costUsd: z.number().nonnegative(),
    priceKnown: z.boolean(),
  }),
});
export type SimulationResult = z.infer<typeof simulationResultSchema>;

// ------------------------------------------------------------------ scenarios

export const AI_SCENARIO_EXPECTATIONS = [
  "must_handoff",
  "must_not_handoff",
  "must_reply",
  "must_cite_price",
  "must_cite_knowledge",
  "must_not_quote",
  "must_not_discount",
  "must_need_approval",
] as const;
export const aiScenarioExpectationSchema = z.enum(AI_SCENARIO_EXPECTATIONS);
export type AiScenarioExpectation = z.infer<typeof aiScenarioExpectationSchema>;

export const aiScenarioInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  messages: z.array(z.string().trim().min(1).max(SIMULATION_MAX_TEXT)).min(1).max(10),
  expectations: z.array(aiScenarioExpectationSchema).min(1).max(AI_SCENARIO_EXPECTATIONS.length),
});
export type AiScenarioInput = z.infer<typeof aiScenarioInputSchema>;

export const aiScenarioSchema = aiScenarioInputSchema.extend({
  id: z.uuid(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AiScenario = z.infer<typeof aiScenarioSchema>;
export const aiScenarioListSchema = z.object({ items: z.array(aiScenarioSchema) });
export type AiScenarioList = z.infer<typeof aiScenarioListSchema>;

export const runScenariosRequestSchema = z.strictObject({
  /** Omitted = every scenario of the tenant. */
  scenarioIds: z.array(z.uuid()).min(1).max(50).optional(),
  draftSystemPrompt: z.string().max(DRAFT_PROMPT_MAX).optional(),
});
export type RunScenariosRequest = z.infer<typeof runScenariosRequestSchema>;

export const scenarioCheckSchema = z.object({
  expectation: aiScenarioExpectationSchema,
  passed: z.boolean(),
  detail: z.string(),
});
export type ScenarioCheck = z.infer<typeof scenarioCheckSchema>;

export const scenarioRunResultSchema = z.object({
  scenarioId: z.uuid(),
  name: z.string(),
  passed: z.boolean(),
  checks: z.array(scenarioCheckSchema),
  simulation: simulationResultSchema.nullable(),
  /** Sanitized failure (provider error, plan limit...) when the simulation could not run. */
  error: z.string().nullable(),
});
export type ScenarioRunResult = z.infer<typeof scenarioRunResultSchema>;

export const runScenariosResponseSchema = z.object({
  results: z.array(scenarioRunResultSchema),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type RunScenariosResponse = z.infer<typeof runScenariosResponseSchema>;
