import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

// --- Commerce / infoproduct integrations ---------------------------------------------------

export const commerceProviderSchema = z.enum(["shopify", "hotmart", "kiwify", "eduzz", "gumroad", "payhip", "tiendanube", "woocommerce"]);
export type CommerceProviderId = z.infer<typeof commerceProviderSchema>;

/** Store platforms with catalog sync. */
export const catalogProviderSchema = z.enum(["shopify", "tiendanube", "woocommerce"]);

/**
 * BYOK credentials. `webhookSecret` is: Shopify app client secret, Hotmart hottok, Kiwify token,
 * Eduzz webhook secret, Gumroad seller id, Payhip API key, Tiendanube app client secret,
 * WooCommerce webhook secret. Stored encrypted; never returned.
 * Catalog sync: `shopDomain` is the store locator (Shopify `x.myshopify.com`, Tiendanube store
 * id, WooCommerce https site URL; validated per provider by the API) plus `accessToken`
 * (Shopify / Tiendanube) or `consumerKey` + `consumerSecret` (WooCommerce REST API).
 */
export const upsertCommerceConnectionRequestSchema = z
  .object({
    webhookSecret: z.string().trim().min(6).max(500),
    accessToken: z.string().trim().min(10).max(500).optional(),
    shopDomain: z.string().trim().min(1).max(300).optional(),
    consumerKey: z.string().trim().regex(/^ck_[A-Za-z0-9]{8,100}$/, "Invalid WooCommerce consumer key").optional(),
    consumerSecret: z.string().trim().regex(/^cs_[A-Za-z0-9]{8,100}$/, "Invalid WooCommerce consumer secret").optional(),
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
