import {
  aiScenarioListSchema,
  aiScenarioSchema,
  runScenariosResponseSchema,
  simulationResultSchema,
  type AiScenario,
  type AiScenarioInput,
  type RunScenariosResponse,
  type SimulateRequest,
  type SimulationResult,
} from "@crmwsp/contracts";
import { request } from "./api";

/** F6 simulator: dry-run turns (no messages are sent) and the scenario regression suite. */
export const simulatorApi = {
  simulate: (body: SimulateRequest): Promise<SimulationResult> =>
    request("/ai/simulate", { method: "POST", body, schema: simulationResultSchema }),
  listScenarios: async (): Promise<AiScenario[]> => (await request("/ai/scenarios", { schema: aiScenarioListSchema })).items,
  installDefaults: async (): Promise<AiScenario[]> =>
    (await request("/ai/scenarios/defaults", { method: "POST", body: {}, schema: aiScenarioListSchema })).items,
  createScenario: (body: AiScenarioInput): Promise<AiScenario> =>
    request("/ai/scenarios", { method: "POST", body, schema: aiScenarioSchema }),
  deleteScenario: (id: string): Promise<undefined> => request(`/ai/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runScenarios: (draftSystemPrompt?: string): Promise<RunScenariosResponse> =>
    request("/ai/scenarios/run", {
      method: "POST",
      body: draftSystemPrompt !== undefined ? { draftSystemPrompt } : {},
      schema: runScenariosResponseSchema,
    }),
};
