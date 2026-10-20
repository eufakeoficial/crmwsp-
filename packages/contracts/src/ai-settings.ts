import { z } from "zod";
import { aiModeSchema } from "./inbox.js";

/*
 * Contracts of the AI settings, knowledge and approvals API (F2-E).
 * Shared by apps/api (validation) and apps/web (response parsing).
 *
 * Adjustments versus the former web-local schemas (apps/web/src/lib/ai-schemas.ts):
 * - `agentConfigSchema.approvalThresholdMinor` is nullable (DB column is nullable; null = no
 *   approval threshold) instead of a forced number.
 * - `knowledgeSourceSchema.status` keeps the web value "error"; the API maps the DB status "failed".
 * - `aiActionSchema` and `aiCitationSchema` already exist in ai.ts (AI turn output), so the list
 *   item is exported as `aiActionItemSchema` / `AiActionItem`.
 * - Request schemas (save connection, create source, decision note) are new: the web used
 *   TypeScript interfaces only.
 * - `aiModeSchema` is reused from inbox.ts (same enum values).
 */

export const AI_PROVIDERS = ["openai", "openrouter", "deepseek", "custom"] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

/** Fixed base URLs of the recommended providers (ADR 0008); `custom` takes the user's URL. */
export const AI_PROVIDER_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
} as const satisfies Record<Exclude<AiProvider, "custom">, string>;

export const AI_MODES = ["off", "assist", "auto"] as const;

const isoDate = z.string();
const currencyCode = z.string().length(3);

export const aiCapabilitiesSchema = z.object({
  structuredOutput: z.boolean(),
  embeddings: z.boolean(),
  transcription: z.boolean(),
});
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>;

export const aiConnectionSchema = z.object({
  provider: aiProviderSchema,
  baseUrl: z.string(),
  apiKeyHint: z.string().nullable(),
  modelCheap: z.string(),
  modelStrong: z.string(),
  capabilities: aiCapabilitiesSchema,
  lastTestedAt: isoDate.nullable(),
  lastTestOk: z.boolean().nullable(),
  monthlyBudgetMinor: z.number().int().nonnegative().nullable(),
  budgetCurrency: currencyCode.nullable(),
});
export type AiConnection = z.infer<typeof aiConnectionSchema>;
/** `GET /ai/connection` answers `null` when nothing is connected yet. */
export const aiConnectionResponseSchema = aiConnectionSchema.nullable();

/** `PUT /ai/connection`. Omitting `apiKey` keeps the stored key (required on first save). */
export const saveAiConnectionRequestSchema = z
  .object({
    provider: aiProviderSchema,
    baseUrl: z.string().trim().max(2048).optional(),
    apiKey: z.string().trim().min(8).max(512).optional(),
    modelCheap: z.string().trim().min(1).max(200),
    modelStrong: z.string().trim().min(1).max(200),
    monthlyBudgetMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    budgetCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .refine((v) => v.provider !== "custom" || (v.baseUrl !== undefined && v.baseUrl.length > 0), {
    path: ["baseUrl"],
    message: "baseUrl is required for custom providers",
  })
  .refine((v) => v.monthlyBudgetMinor === undefined || v.budgetCurrency !== undefined, {
    path: ["budgetCurrency"],
    message: "budgetCurrency is required with a monthly budget",
  });
export type SaveAiConnectionInput = z.input<typeof saveAiConnectionRequestSchema>;

export const aiTestResultSchema = z.object({
  ok: z.boolean(),
  capabilities: aiCapabilitiesSchema,
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});
export type AiTestResult = z.infer<typeof aiTestResultSchema>;

/** `GET /ai/usage?month=YYYY-MM` (defaults to the current month). */
export const aiUsageQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM")
    .optional(),
});

export const aiUsageSchema = z.object({
  spentMinor: z.number().int().nonnegative(),
  currency: z.string(),
  budgetMinor: z.number().int().nonnegative().nullable(),
  /**
   * true when the reporting currency is not USD but the ledger holds USD micro-cents (LLM costs):
   * no FX conversion is done, so those rows are NOT in `spentMinor`/`byKind`.
   */
  currencyMismatch: z.boolean(),
  /** true when some priced usage comes from unverified or unknown model prices. */
  estimated: z.boolean(),
  byKind: z.array(z.object({ kind: z.string(), costMinor: z.number().int().nonnegative() })),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;

export const agentConfigSchema = z.object({
  systemPrompt: z.string().max(20_000),
  aiModeDefault: aiModeSchema,
  confidenceThreshold: z.number().min(0).max(1),
  /** null = no approval threshold configured. */
  approvalThresholdMinor: z.number().int().nonnegative().nullable(),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const KNOWLEDGE_KINDS = ["csv", "pdf", "faq", "text"] as const;
export const knowledgeKindSchema = z.enum(KNOWLEDGE_KINDS);
export type KnowledgeKind = z.infer<typeof knowledgeKindSchema>;

export const knowledgeSourceSchema = z.object({
  id: z.string(),
  kind: knowledgeKindSchema,
  title: z.string(),
  status: z.enum(["pending", "processing", "ready", "error"]),
  version: z.number().int(),
  chunkCount: z.number().int().nonnegative(),
  updatedAt: isoDate,
  error: z.string().optional(),
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export const knowledgeSourceListSchema = z.object({ items: z.array(knowledgeSourceSchema) });

/** JSON body of `POST /knowledge/sources` for text-like sources (csv/pdf go as multipart). */
export const createTextKnowledgeSourceRequestSchema = z.object({
  kind: z.enum(["faq", "text"]),
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(500_000),
});
export type CreateTextKnowledgeSourceRequest = z.infer<typeof createTextKnowledgeSourceRequestSchema>;

export type CreateKnowledgeSourceInput =
  | { kind: "csv" | "pdf"; file: File }
  | { kind: "faq" | "text"; title: string; content: string };

/** 422 details when a catalog cannot be parsed: at most `KNOWLEDGE_MAX_ROW_ERRORS` rows. */
export const KNOWLEDGE_MAX_ROW_ERRORS = 50;
export const knowledgeRowErrorSchema = z.object({ line: z.number().int().nonnegative(), reason: z.string() });
export type KnowledgeRowError = z.infer<typeof knowledgeRowErrorSchema>;

export const knowledgeConflictSchema = z.object({
  key: z.string(),
  sources: z.array(
    z.object({ sourceId: z.string(), title: z.string(), priceMinor: z.number().int(), currency: z.string() }),
  ),
});
export const knowledgeConflictListSchema = z.object({ items: z.array(knowledgeConflictSchema) });
export type KnowledgeConflict = z.infer<typeof knowledgeConflictSchema>;

export const AI_ACTION_STATUSES = ["proposed", "pending_approval", "approved", "rejected", "executed", "failed"] as const;
export const aiActionStatusSchema = z.enum(AI_ACTION_STATUSES);
export type AiActionStatus = z.infer<typeof aiActionStatusSchema>;

export const aiActionsQuerySchema = z.object({
  status: aiActionStatusSchema.optional(),
  /** e.g. "draft_reply" (assist-mode drafts saved by the worker). */
  type: z.string().min(1).max(100).optional(),
  conversationId: z.uuid().optional(),
});

/** Item of `GET /ai/actions` (named `Item` because `aiActionSchema` is the AI turn action in ai.ts). */
export const aiActionItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  conversationId: z.string().nullable(),
  contactName: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  citations: z.array(z.object({ chunkId: z.string(), title: z.string().optional(), excerpt: z.string().optional() })),
  createdAt: isoDate,
});
export type AiActionItem = z.infer<typeof aiActionItemSchema>;
export const aiActionItemListSchema = z.object({ items: z.array(aiActionItemSchema) });

/** Optional body of approve/reject. */
export const aiActionDecisionRequestSchema = z.object({ note: z.string().trim().min(1).max(1000).optional() });
export type AiActionDecisionRequest = z.infer<typeof aiActionDecisionRequestSchema>;

/** Response of approve/reject. */
export const aiActionDecisionResponseSchema = z.object({ id: z.string(), status: z.string() });
export type AiActionDecisionResponse = z.infer<typeof aiActionDecisionResponseSchema>;
export type AiActionItemList = z.infer<typeof aiActionItemListSchema>;
