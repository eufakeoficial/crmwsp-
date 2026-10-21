import { eduzzConnector, gumroadConnector, hotmartConnector, kiwifyConnector, payhipConnector } from "./adapters/infoproducts.js";
import { shopifyConnector } from "./adapters/shopify.js";
import { tiendanubeConnector } from "./adapters/tiendanube.js";
import { woocommerceConnector } from "./adapters/woocommerce.js";
import type { CommerceConnector, CommerceProvider } from "./types.js";

export * from "./types.js";
export { CommercePayloadError, InvalidSignatureError, decimalToMinor } from "./util.js";
export { SHOPIFY_API_VERSION, isShopifyDomain, normalizeShopifyProduct, shopifyConnector } from "./adapters/shopify.js";
export { isTiendanubeStoreId, normalizeTiendanubeProduct, tiendanubeConnector } from "./adapters/tiendanube.js";
export { normalizeWooProduct, normalizeWooSiteUrl, woocommerceConnector } from "./adapters/woocommerce.js";
export { eduzzConnector, gumroadConnector, hotmartConnector, kiwifyConnector, payhipConnector } from "./adapters/infoproducts.js";
export { decideExternalSale, type ExternalSaleDecision, type OrderSnapshot } from "./trust.js";

export const commerceConnectors: Readonly<Record<CommerceProvider, CommerceConnector>> = {
  shopify: shopifyConnector,
  hotmart: hotmartConnector,
  kiwify: kiwifyConnector,
  eduzz: eduzzConnector,
  gumroad: gumroadConnector,
  payhip: payhipConnector,
  tiendanube: tiendanubeConnector,
  woocommerce: woocommerceConnector,
};

/** Store platforms with a catalog pull (`listProducts`). */
export const catalogProviders = ["shopify", "tiendanube", "woocommerce"] as const satisfies readonly CommerceProvider[];
export type CatalogProvider = (typeof catalogProviders)[number];

export function isCatalogProvider(p: string): p is CatalogProvider {
  return (catalogProviders as readonly string[]).includes(p);
}

export function connectorFor(provider: CommerceProvider): CommerceConnector {
  return commerceConnectors[provider];
}
