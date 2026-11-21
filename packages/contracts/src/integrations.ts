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
  /** Webhook authenticated only by a static/semi-public value: the UI must warn (CN-016). */
  weakAuth: z.boolean(),
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

/** Alphabet of WooCommerce connect codes: base32 without the look-alikes 0/O/1/I. */
export const CONNECT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CONNECT_CODE_LENGTH = 10;

/** Issued once in the panel; pasted into the WordPress plugin. `code` is shown as XXXX-XXXX-XX. */
export const wooConnectCodeResponseSchema = z.object({
  code: z.string(),
  expiresAt: isoDateTimeSchema,
});
export type WooConnectCodeResponse = z.infer<typeof wooConnectCodeResponseSchema>;

/** Accepts the code as typed (any case, dashes / spaces) and normalizes it to its 10 raw chars. */
export const connectCodeSchema = z
  .string()
  .max(40)
  .transform((s) => s.toUpperCase().replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{10}$/, "Invalid connect code"));

/** Public exchange called by the WordPress plugin: connect code + store credentials. */
export const wooPublicConnectRequestSchema = z
  .object({
    code: connectCodeSchema,
    shopUrl: z
      .string()
      .trim()
      .max(500)
      .url()
      .refine((u) => u.startsWith("https://"), "The store URL must use https"),
    consumerKey: z.string().trim().regex(/^ck_[A-Za-z0-9]{8,100}$/, "Invalid WooCommerce consumer key"),
    consumerSecret: z.string().trim().regex(/^cs_[A-Za-z0-9]{8,100}$/, "Invalid WooCommerce consumer secret"),
    webhookSecret: z.string().trim().min(16).max(500),
  })
  .strict();
export type WooPublicConnectRequest = z.infer<typeof wooPublicConnectRequestSchema>;

export const wooPublicConnectResponseSchema = z.object({
  webhookUrl: z.string(),
  tenantName: z.string(),
});
export type WooPublicConnectResponse = z.infer<typeof wooPublicConnectResponseSchema>;
