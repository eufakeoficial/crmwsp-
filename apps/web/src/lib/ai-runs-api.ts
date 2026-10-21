import { aiHandoffListSchema, aiRunListSchema, type AiHandoffList, type AiRunList, type AiRunMode, type AiRunOutcome } from "@crmwsp/contracts";
import { request } from "./api";

export interface AiRunsParams {
  outcome?: AiRunOutcome | undefined;
  mode?: AiRunMode | undefined;
  cursor?: string | null | undefined;
}

/** Read models of the AI section: what the AI did and which conversations need a human. */
export const aiRunsApi = {
  runs: (p: AiRunsParams = {}): Promise<AiRunList> =>
    request("/ai/runs", { query: { outcome: p.outcome, mode: p.mode, cursor: p.cursor ?? undefined, limit: 25 }, schema: aiRunListSchema }),
  handoffs: (p: { assignedTo?: "me" | "unassigned" | undefined; cursor?: string | null | undefined } = {}): Promise<AiHandoffList> =>
    request("/ai/handoffs", { query: { assignedTo: p.assignedTo, cursor: p.cursor ?? undefined, limit: 25 }, schema: aiHandoffListSchema }),
};
