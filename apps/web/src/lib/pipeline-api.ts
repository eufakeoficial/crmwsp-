import { opportunityListSchema, opportunitySchema, pipelineListSchema, type CreateOpportunityRequest } from "@crmwsp/contracts";
import { request } from "./api";

export const pipelineApi = {
  pipelines: () => request("/pipelines", { schema: pipelineListSchema }),
  opportunities: (q: { pipelineId: string; cursor?: string | undefined; limit?: number }) =>
    request("/opportunities", { query: { pipelineId: q.pipelineId, cursor: q.cursor, limit: q.limit ?? 100 }, schema: opportunityListSchema }),
  /** Starts in the first open stage of the default pipeline unless `stageId` is given. */
  create: (input: CreateOpportunityRequest) => request("/opportunities", { method: "POST", body: input, schema: opportunitySchema }),
  /** The API validates that the stage belongs to the pipeline; `lostReason` is mandatory for lost stages. */
  move: (id: string, input: { stageId: string; lockVersion: number; lostReason?: string }) =>
    request(`/opportunities/${id}/move`, { method: "POST", body: input, schema: opportunitySchema }),
};
