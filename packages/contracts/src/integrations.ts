import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

// --- Commerce / infoproduct integrations ---------------------------------------------------

export const commerceProviderSchema = z.enum(["shopify", "hotmart", "kiwify", "eduzz", "gumroad", "payhip"]);
export type CommerceProviderId = z.infer<typeof commerceProviderSchema>;

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

/**
 * BYOK credentials. `webhookSecret` is: Shopify app client secret, Hotmart hottok, Kiwify token,
 * Eduzz webhook secret, Gumroad seller id, Payhip API key. Stored encrypted; never returned.
 * Shopify additionally needs `shopDomain` + `accessToken` (Admin API) for catalog sync.
 */
export const upsertCommerceConnectionRequestSchema = z
  .object({
    webhookSecret: z.string().trim().min(6).max(500),
    accessToken: z.string().trim().min(10).max(500).optional(),
    shopDomain: z.string().trim().toLowerCase().regex(SHOP_DOMAIN_RE, "Use your-shop.myshopify.com").optional(),
  })
  .strict();
export type UpsertCommerceConnectionRequest = z.infer<typeof upsertCommerceConnectionRequestSchema>;

export const commerceConnectionSchema = z.object({
  provider: commerceProviderSchema,
  status: z.enum(["active", "disabled"]),
  secretHint: z.string().nullable(),
  shopDomain: z.string().nullable(),
  hasAccessToken: z.boolean(),
  webhookUrl: z.string(),
  lastSyncedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type CommerceConnectionView = z.infer<typeof commerceConnectionSchema>;

export const commerceConnectionListSchema = z.object({ items: z.array(commerceConnectionSchema) });
export type CommerceConnectionList = z.infer<typeof commerceConnectionListSchema>;

export const catalogSyncResultSchema = z.object({
  products: z.number().int(),
  variants: z.number().int(),
  currency: z.string(),
  syncedAt: isoDateTimeSchema,
});
export type CatalogSyncResult = z.infer<typeof catalogSyncResultSchema>;
