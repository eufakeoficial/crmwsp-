import { opportunityListSchema, opportunitySchema, pipelineListSchema } from "@crmwsp/contracts";
import { request } from "./api";

export const pipelineApi = {
  pipelines: () => request("/pipelines", { schema: pipelineListSchema }),
  opportunities: (q: { pipelineId: string; cursor?: string | undefined; limit?: number }) =>
    request("/opportunities", { query: { pipelineId: q.pipelineId, cursor: q.cursor, limit: q.limit ?? 100 }, schema: opportunityListSchema }),
  /** The API validates that the stage belongs to the pipeline; `lostReason` is mandatory for lost stages. */
  move: (id: string, input: { stageId: string; lockVersion: number; lostReason?: string }) =>
    request(`/opportunities/${id}/move`, { method: "POST", body: input, schema: opportunitySchema }),
};
