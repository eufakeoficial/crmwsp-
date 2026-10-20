import { ValidationError, type UpsertCommerceConnectionRequest } from "@crmwsp/contracts";
import { isCatalogProvider, isShopifyDomain, isTiendanubeStoreId, normalizeWooSiteUrl, type CommerceProvider } from "@crmwsp/integrations";

export interface StoreCredentials {
  /** Normalized store locator, or undefined when not sent. */
  shopDomain?: string;
  /** Plain API credential to encrypt (WooCommerce: `ck:cs`), or undefined when not sent. */
  accessToken?: string;
}

/**
 * Validates the per-provider catalog credentials of an upsert. Only store platforms take a store
 * locator / API credential, and a credential always needs its locator (it is only ever sent there).
 */
export function resolveStoreCredentials(provider: CommerceProvider, input: UpsertCommerceConnectionRequest): StoreCredentials {
  const hasWooKeys = input.consumerKey !== undefined || input.consumerSecret !== undefined;
  if (!isCatalogProvider(provider)) {
    if (input.accessToken || input.shopDomain || hasWooKeys) throw new ValidationError("This provider takes no store credentials");
    return {};
  }
  let shopDomain: string | undefined;
  if (input.shopDomain !== undefined) {
    const raw = input.shopDomain.trim();
    if (provider === "shopify") {
      const d = raw.toLowerCase();
      if (!isShopifyDomain(d)) throw new ValidationError("Use your-shop.myshopify.com");
      shopDomain = d;
    } else if (provider === "tiendanube") {
      if (!isTiendanubeStoreId(raw)) throw new ValidationError("Use the numeric Tiendanube store id");
      shopDomain = raw;
    } else {
      const url = normalizeWooSiteUrl(raw);
      if (!url) throw new ValidationError("Use the public https URL of your WooCommerce store");
      shopDomain = url;
    }
  }
  let accessToken: string | undefined;
  if (provider === "woocommerce") {
    if (input.accessToken) throw new ValidationError("WooCommerce uses consumerKey + consumerSecret");
    if (hasWooKeys) {
      if (!input.consumerKey || !input.consumerSecret) throw new ValidationError("Send both consumerKey and consumerSecret");
      accessToken = `${input.consumerKey}:${input.consumerSecret}`;
    }
  } else {
    if (hasWooKeys) throw new ValidationError("Only WooCommerce takes consumerKey + consumerSecret");
    accessToken = input.accessToken;
  }
  if (accessToken && !shopDomain) throw new ValidationError("An API credential needs the store locator");
  return { ...(shopDomain ? { shopDomain } : {}), ...(accessToken ? { accessToken } : {}) };
}
