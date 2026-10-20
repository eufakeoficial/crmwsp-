import {
  type CommerceProviderId,
  type UpsertCommerceConnectionRequest,
  catalogSyncResultSchema,
  commerceConnectionListSchema,
  commerceConnectionSchema,
} from "@crmwsp/contracts";
import { request } from "./api";

export const integrationsApi = {
  list: () => request("/integrations/commerce", { schema: commerceConnectionListSchema }),
  save: (provider: CommerceProviderId, input: UpsertCommerceConnectionRequest) =>
    request(`/integrations/commerce/${provider}`, { method: "PUT", body: input, schema: commerceConnectionSchema }),
  disable: (provider: CommerceProviderId) => request(`/integrations/commerce/${provider}`, { method: "DELETE" }),
  syncShopify: () => request("/integrations/commerce/shopify/sync", { method: "POST", schema: catalogSyncResultSchema }),
};
