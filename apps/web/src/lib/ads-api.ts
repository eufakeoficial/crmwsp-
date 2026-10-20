import {
  adReportSchema,
  metaAdAccountsSchema,
  metaAdsStateSchema,
  metaCapiStateSchema,
  type AdRecommendationSettings,
  type AdReportGroupBy,
  type UpsertAdSpendRequest,
  type UpsertMetaAdsRequest,
  type UpsertMetaCapiRequest,
} from "@crmwsp/contracts";
import { request } from "./api";

export const adsApi = {
  report: (q: { from?: string; to?: string; groupBy?: AdReportGroupBy } = {}) =>
    request("/ads/report", { query: { from: q.from, to: q.to, groupBy: q.groupBy }, schema: adReportSchema }),
  saveSpend: (input: UpsertAdSpendRequest) => request("/ads/spend", { method: "PUT", body: input }),
  saveSettings: (input: AdRecommendationSettings) => request("/ads/settings", { method: "PUT", body: input }),
  capi: () => request("/integrations/meta-capi", { schema: metaCapiStateSchema }),
  saveCapi: (input: UpsertMetaCapiRequest) => request("/integrations/meta-capi", { method: "PUT", body: input }),
  disableCapi: () => request("/integrations/meta-capi", { method: "DELETE" }),
  metaAds: () => request("/integrations/meta-ads", { schema: metaAdsStateSchema }),
  adAccounts: (accessToken?: string) =>
    request("/integrations/meta-ads/ad-accounts", { method: "POST", body: accessToken ? { accessToken } : {}, schema: metaAdAccountsSchema }),
  saveMetaAds: (input: UpsertMetaAdsRequest) => request("/integrations/meta-ads", { method: "PUT", body: input }),
  syncMetaAds: () => request("/integrations/meta-ads/sync", { method: "POST", body: {} }),
  disableMetaAds: () => request("/integrations/meta-ads", { method: "DELETE" }),
};
