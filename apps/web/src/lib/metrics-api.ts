import { salesMetricsSchema } from "@crmwsp/contracts";
import { request } from "./api";

export const metricsApi = {
  sales: (q: { from?: string; to?: string } = {}) =>
    request("/metrics/sales", { query: { from: q.from, to: q.to }, schema: salesMetricsSchema }),
};
