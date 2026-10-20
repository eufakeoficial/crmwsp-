import { billingPlanResponseSchema } from "@crmwsp/contracts";
import { request } from "./api";

export const billingApi = {
  plan: () => request("/billing/plan", { schema: billingPlanResponseSchema }),
};
