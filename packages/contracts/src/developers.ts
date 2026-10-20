import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

/** Public API key scopes (minimal set). `write:messages` is reserved for the send endpoint. */
export const apiKeyScopes = ["read:orders", "read:contacts", "write:messages"] as const;
export const apiKeyScopeSchema = z.enum(apiKeyScopes);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const createApiKeyRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(apiKeyScopeSchema).min(1).max(apiKeyScopes.length),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

export const apiKeyViewSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  lastUsedAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ApiKeyView = z.infer<typeof apiKeyViewSchema>;
export const apiKeyListSchema = z.object({ items: z.array(apiKeyViewSchema) });
export type ApiKeyList = z.infer<typeof apiKeyListSchema>;

/** Returned ONLY by create: the plaintext key is never shown again. */
export const createdApiKeySchema = apiKeyViewSchema.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const webhookEventTypes = ["order.created", "order.paid", "contact.created", "message.received"] as const;
export const webhookEventTypeSchema = z.enum(webhookEventTypes);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

const webhookUrlSchema = z.string().trim().url().max(2048);

export const createWebhookEndpointRequestSchema = z.object({
  url: webhookUrlSchema,
  events: z.array(webhookEventTypeSchema).min(1).max(webhookEventTypes.length),
  description: z.string().trim().max(200).optional(),
});
export type CreateWebhookEndpointRequest = z.infer<typeof createWebhookEndpointRequestSchema>;

export const updateWebhookEndpointRequestSchema = z
  .object({
    url: webhookUrlSchema.optional(),
    events: z.array(webhookEventTypeSchema).min(1).max(webhookEventTypes.length).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    /** `active` re-enables an auto-disabled endpoint and resets its failure counter. */
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateWebhookEndpointRequest = z.infer<typeof updateWebhookEndpointRequestSchema>;

export const webhookEndpointViewSchema = z.object({
  id: uuidSchema,
  url: z.string(),
  description: z.string().nullable(),
  events: z.array(webhookEventTypeSchema),
  status: z.enum(["active", "disabled"]),
  disabledReason: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  secretHint: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type WebhookEndpointView = z.infer<typeof webhookEndpointViewSchema>;
export const webhookEndpointListSchema = z.object({ items: z.array(webhookEndpointViewSchema) });
export type WebhookEndpointList = z.infer<typeof webhookEndpointListSchema>;

/** Returned ONLY by create: the signing secret is never shown again. */
export const createdWebhookEndpointSchema = webhookEndpointViewSchema.extend({ secret: z.string() });
export type CreatedWebhookEndpoint = z.infer<typeof createdWebhookEndpointSchema>;

export const webhookDeliveryStatusSchema = z.enum(["pending", "delivered", "failed"]);
export const webhookDeliveryViewSchema = z.object({
  id: uuidSchema,
  eventId: uuidSchema,
  eventType: webhookEventTypeSchema,
  status: webhookDeliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  nextAttemptAt: isoDateTimeSchema.nullable(),
  deliveredAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type WebhookDeliveryView = z.infer<typeof webhookDeliveryViewSchema>;
export const webhookDeliveryListSchema = z.object({ items: z.array(webhookDeliveryViewSchema) });
export type WebhookDeliveryList = z.infer<typeof webhookDeliveryListSchema>;

/** Envelope POSTed to tenant endpoints. */
export interface WebhookEventEnvelope {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: Record<string, unknown>;
}

// ---- Public API v1 (Bearer API key) ----

export const publicListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Opaque cursor: the `nextCursor` of the previous page. */
  cursor: z.string().min(1).max(200).optional(),
});
export type PublicListQuery = z.infer<typeof publicListQuerySchema>;

export const publicOrderSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: z.string(),
  currency: z.string(),
  totalMinor: z.string(),
  contactId: uuidSchema,
  paidAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PublicOrder = z.infer<typeof publicOrderSchema>;
export const publicOrderItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPriceMinor: z.string(),
  lineTotalMinor: z.string(),
});
export const publicOrderDetailSchema = publicOrderSchema.extend({ items: z.array(publicOrderItemSchema) });
export type PublicOrderDetail = z.infer<typeof publicOrderDetailSchema>;

export const publicContactSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  phoneE164: z.string(),
  createdAt: isoDateTimeSchema,
});
export type PublicContact = z.infer<typeof publicContactSchema>;

export interface PublicPage<T> {
  data: T[];
  nextCursor: string | null;
}
