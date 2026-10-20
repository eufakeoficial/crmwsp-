import { profitabilitySchema, type ProfitabilityGroupBy } from "@crmwsp/contracts";
import { request } from "./api";

export const analyticsApi = {
  profitability: (q: { from?: string; to?: string; currency?: string; groupBy?: ProfitabilityGroupBy } = {}) =>
    request("/analytics/profitability", {
      query: { from: q.from, to: q.to, currency: q.currency, groupBy: q.groupBy },
      schema: profitabilitySchema,
    }),
};
