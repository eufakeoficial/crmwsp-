import { billingPlanResponseSchema, referralSummarySchema } from "@crmwsp/contracts";
import { request } from "./api";

export const billingApi = {
  plan: () => request("/billing/plan", { schema: billingPlanResponseSchema }),
  referrals: () => request("/billing/referrals", { schema: referralSummarySchema }),
};
