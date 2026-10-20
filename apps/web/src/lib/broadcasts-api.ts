import {
  audiencePreviewSchema,
  broadcastListSchema,
  broadcastSchema,
  broadcastStatsSchema,
  broadcastTemplateListSchema,
  type BroadcastAudience,
  type CreateBroadcastRequest,
} from "@crmwsp/contracts";
import { request } from "./api";

export const broadcastsApi = {
  list: () => request("/broadcasts", { schema: broadcastListSchema }),
  templates: () => request("/broadcasts/templates", { schema: broadcastTemplateListSchema }),
  preview: (audience: BroadcastAudience) =>
    request("/broadcasts/preview", { method: "POST", body: { audience }, schema: audiencePreviewSchema }),
  create: (body: CreateBroadcastRequest) => request("/broadcasts", { method: "POST", body, schema: broadcastSchema }),
  schedule: (id: string, scheduledAt?: string) =>
    request(`/broadcasts/${id}/schedule`, { method: "POST", body: scheduledAt ? { scheduledAt } : {}, schema: broadcastSchema }),
  cancel: (id: string) => request(`/broadcasts/${id}/cancel`, { method: "POST", schema: broadcastSchema }),
  remove: (id: string) => request(`/broadcasts/${id}`, { method: "DELETE" }),
  stats: (id: string) => request(`/broadcasts/${id}/stats`, { schema: broadcastStatsSchema }),
};
