import { z } from "zod";

// TODO(F2-E): replace with @crmwsp/contracts schemas

export const AI_PROVIDERS = ["openai", "openrouter", "deepseek", "custom"] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

const isoDate = z.string();

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
  budgetCurrency: z.string().length(3).nullable(),
});
export type AiConnection = z.infer<typeof aiConnectionSchema>;
/** `GET /ai/connection` answers `null` when nothing is connected yet. */
export const aiConnectionResponseSchema = aiConnectionSchema.nullable();

export interface SaveAiConnectionInput {
  provider: AiProvider;
  baseUrl?: string | undefined;
  /** Omitted: the stored key is kept. */
  apiKey?: string | undefined;
  modelCheap: string;
  modelStrong: string;
  monthlyBudgetMinor?: number | undefined;
  budgetCurrency?: string | undefined;
}

export const aiTestResultSchema = z.object({
  ok: z.boolean(),
  capabilities: aiCapabilitiesSchema,
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});
export type AiTestResult = z.infer<typeof aiTestResultSchema>;

export const aiUsageSchema = z.object({
  spentMinor: z.number().int().nonnegative(),
  currency: z.string(),
  budgetMinor: z.number().int().nonnegative().nullable(),
  byKind: z.array(z.object({ kind: z.string(), costMinor: z.number().int().nonnegative() })),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;

export const AI_MODES = ["off", "assist", "auto"] as const;
export const aiModeSchema = z.enum(AI_MODES);
export type AiMode = z.infer<typeof aiModeSchema>;

export const agentConfigSchema = z.object({
  systemPrompt: z.string(),
  aiModeDefault: aiModeSchema,
  confidenceThreshold: z.number().min(0).max(1),
  approvalThresholdMinor: z.number().int().nonnegative(),
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

export type CreateKnowledgeSourceInput =
  | { kind: "csv" | "pdf"; file: File }
  | { kind: "faq" | "text"; title: string; content: string };

export const knowledgeConflictListSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      sources: z.array(z.object({ sourceId: z.string(), title: z.string(), priceMinor: z.number().int(), currency: z.string() })),
    }),
  ),
});
export type KnowledgeConflict = z.infer<typeof knowledgeConflictListSchema>["items"][number];

export const aiActionSchema = z.object({
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
export type AiAction = z.infer<typeof aiActionSchema>;
export const aiActionListSchema = z.object({ items: z.array(aiActionSchema) });
