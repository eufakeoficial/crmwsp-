import { request } from "./api";
import {
  type AgentConfig,
  type AiActionItem,
  type AiConnection,
  type AiTestResult,
  type AiUsage,
  type CreateKnowledgeSourceInput,
  type KnowledgeConflict,
  type KnowledgeSource,
  type SaveAiConnectionInput,
  agentConfigSchema,
  aiActionItemListSchema,
  aiConnectionResponseSchema,
  aiConnectionSchema,
  aiTestResultSchema,
  aiUsageSchema,
  knowledgeConflictListSchema,
  knowledgeSourceListSchema,
  knowledgeSourceSchema,
} from "@crmwsp/contracts";
import { mockAiApi, mockKnowledgeApi } from "./ai-api.mock";

export interface AiApi {
  getConnection: () => Promise<AiConnection | null>;
  saveConnection: (input: SaveAiConnectionInput) => Promise<AiConnection>;
  testConnection: () => Promise<AiTestResult>;
  deleteConnection: () => Promise<void>;
  usage: (month: string) => Promise<AiUsage>;
  getAgentConfig: () => Promise<AgentConfig>;
  saveAgentConfig: (input: AgentConfig) => Promise<AgentConfig>;
  listActions: (status?: string) => Promise<AiActionItem[]>;
  approveAction: (id: string, note?: string) => Promise<void>;
  rejectAction: (id: string, note?: string) => Promise<void>;
}

export interface KnowledgeApi {
  listSources: () => Promise<KnowledgeSource[]>;
  createSource: (input: CreateKnowledgeSourceInput) => Promise<KnowledgeSource>;
  deleteSource: (id: string) => Promise<void>;
  conflicts: () => Promise<KnowledgeConflict[]>;
}

const noteBody = (note?: string) => (note?.trim() ? { note: note.trim() } : {});

const realAiApi: AiApi = {
  getConnection: () => request("/ai/connection", { schema: aiConnectionResponseSchema }),
  saveConnection: (input) => request("/ai/connection", { method: "PUT", body: input, schema: aiConnectionSchema }),
  testConnection: () => request("/ai/connection/test", { method: "POST", schema: aiTestResultSchema }),
  deleteConnection: () => request("/ai/connection", { method: "DELETE" }),
  usage: (month) => request("/ai/usage", { query: { month }, schema: aiUsageSchema }),
  getAgentConfig: () => request("/ai/agent-config", { schema: agentConfigSchema }),
  saveAgentConfig: (input) => request("/ai/agent-config", { method: "PUT", body: input, schema: agentConfigSchema }),
  listActions: async (status = "pending_approval") =>
    (await request("/ai/actions", { query: { status }, schema: aiActionItemListSchema })).items,
  approveAction: (id, note) => request(`/ai/actions/${id}/approve`, { method: "POST", body: noteBody(note) }),
  rejectAction: (id, note) => request(`/ai/actions/${id}/reject`, { method: "POST", body: noteBody(note) }),
};

const realKnowledgeApi: KnowledgeApi = {
  listSources: async () => (await request("/knowledge/sources", { schema: knowledgeSourceListSchema })).items,
  createSource: (input) => {
    if ("file" in input) {
      const form = new FormData();
      form.set("kind", input.kind);
      form.set("file", input.file);
      return request("/knowledge/sources", { method: "POST", body: form, schema: knowledgeSourceSchema });
    }
    return request("/knowledge/sources", { method: "POST", body: input, schema: knowledgeSourceSchema });
  },
  deleteSource: (id) => request(`/knowledge/sources/${id}`, { method: "DELETE" }),
  conflicts: async () => (await request("/knowledge/conflicts", { schema: knowledgeConflictListSchema })).items,
};

/** The in-memory mock is dev-only: NEXT_PUBLIC_AI_API_MOCK=1 is ignored in production builds. */
export const AI_MOCK_ENABLED = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_AI_API_MOCK === "1";

export const aiApi: AiApi = AI_MOCK_ENABLED ? mockAiApi : realAiApi;
export const knowledgeApi: KnowledgeApi = AI_MOCK_ENABLED ? mockKnowledgeApi : realKnowledgeApi;
export { realAiApi, realKnowledgeApi };
