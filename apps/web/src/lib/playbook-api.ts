import {
  aiRunsSummarySchema,
  playbookResponseSchema,
  type AiRunsSummary,
  type PlaybookResponse,
  type SavePlaybookRequest,
} from "@crmwsp/contracts";
import { request } from "./api";

export const playbookApi = {
  get: (): Promise<PlaybookResponse> => request("/ai/playbook", { schema: playbookResponseSchema }),
  save: (input: SavePlaybookRequest): Promise<PlaybookResponse> =>
    request("/ai/playbook", { method: "PUT", body: input, schema: playbookResponseSchema }),
  /** Read-only outcome attribution per detected stage / objection (owner and admin only). */
  summary: (days = 30): Promise<AiRunsSummary> => request("/ai/runs/summary", { query: { days }, schema: aiRunsSummarySchema }),
};
