import {
  type CommerceProviderId,
  type UpsertCommerceConnectionRequest,
  type UpsertMercadoPagoConnectionRequest,
  catalogSyncResultSchema,
  commerceConnectionListSchema,
  commerceConnectionSchema,
  mercadoPagoConnectionSchema,
} from "@crmwsp/contracts";
import { request } from "./api";

export type CatalogProviderId = "shopify" | "tiendanube" | "woocommerce";

export const integrationsApi = {
  list: () => request("/integrations/commerce", { schema: commerceConnectionListSchema }),
  save: (provider: CommerceProviderId, input: UpsertCommerceConnectionRequest) =>
    request(`/integrations/commerce/${provider}`, { method: "PUT", body: input, schema: commerceConnectionSchema }),
  disable: (provider: CommerceProviderId) => request(`/integrations/commerce/${provider}`, { method: "DELETE" }),
  syncCatalog: (provider: CatalogProviderId) => request(`/integrations/commerce/${provider}/sync`, { method: "POST", schema: catalogSyncResultSchema }),
  syncShopify: () => integrationsApi.syncCatalog("shopify"),
  getMercadoPago: () => request("/payments/mercadopago/connection", { schema: mercadoPagoConnectionSchema }),
  saveMercadoPago: (input: UpsertMercadoPagoConnectionRequest) =>
    request("/payments/mercadopago/connection", { method: "PUT", body: input, schema: mercadoPagoConnectionSchema }),
};
