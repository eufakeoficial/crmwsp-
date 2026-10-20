import { adReportSchema, metaCapiStateSchema, type UpsertAdSpendRequest, type UpsertMetaCapiRequest } from "@crmwsp/contracts";
import { request } from "./api";

export const adsApi = {
  report: () => request("/ads/report", { schema: adReportSchema }),
  saveSpend: (input: UpsertAdSpendRequest) => request("/ads/spend", { method: "PUT", body: input }),
  capi: () => request("/integrations/meta-capi", { schema: metaCapiStateSchema }),
  saveCapi: (input: UpsertMetaCapiRequest) => request("/integrations/meta-capi", { method: "PUT", body: input }),
  disableCapi: () => request("/integrations/meta-capi", { method: "DELETE" }),
};
