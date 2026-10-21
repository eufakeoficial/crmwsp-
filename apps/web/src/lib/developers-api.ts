import {
  type CreateApiKeyRequest,
  type CreateWebhookEndpointRequest,
  type UpdateWebhookEndpointRequest,
  apiKeyListSchema,
  createdApiKeySchema,
  createdWebhookEndpointSchema,
  webhookDeliveryListSchema,
  webhookEndpointListSchema,
  webhookEndpointViewSchema,
} from "@crmwsp/contracts";
import { request } from "./api";

export const developersApi = {
  listKeys: () => request("/developers/api-keys", { schema: apiKeyListSchema }),
  createKey: (input: CreateApiKeyRequest) => request("/developers/api-keys", { method: "POST", body: input, schema: createdApiKeySchema }),
  revokeKey: (id: string) => request(`/developers/api-keys/${id}`, { method: "DELETE" }),
  listEndpoints: () => request("/developers/webhooks", { schema: webhookEndpointListSchema }),
  createEndpoint: (input: CreateWebhookEndpointRequest) =>
    request("/developers/webhooks", { method: "POST", body: input, schema: createdWebhookEndpointSchema }),
  updateEndpoint: (id: string, input: UpdateWebhookEndpointRequest) =>
    request(`/developers/webhooks/${id}`, { method: "PATCH", body: input, schema: webhookEndpointViewSchema }),
  deleteEndpoint: (id: string) => request(`/developers/webhooks/${id}`, { method: "DELETE" }),
  deliveries: (id: string) => request(`/developers/webhooks/${id}/deliveries`, { schema: webhookDeliveryListSchema }),
};
