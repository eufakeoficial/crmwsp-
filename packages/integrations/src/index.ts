import { eduzzConnector, gumroadConnector, hotmartConnector, kiwifyConnector, payhipConnector } from "./adapters/infoproducts.js";
import { shopifyConnector } from "./adapters/shopify.js";
import type { CommerceConnector, CommerceProvider } from "./types.js";

export * from "./types.js";
export { CommercePayloadError, InvalidSignatureError, decimalToMinor } from "./util.js";
export { SHOPIFY_API_VERSION, isShopifyDomain, normalizeShopifyProduct, shopifyConnector } from "./adapters/shopify.js";
export { eduzzConnector, gumroadConnector, hotmartConnector, kiwifyConnector, payhipConnector } from "./adapters/infoproducts.js";
export { decideExternalSale, type ExternalSaleDecision, type OrderSnapshot } from "./trust.js";

export const commerceConnectors: Readonly<Record<CommerceProvider, CommerceConnector>> = {
  shopify: shopifyConnector,
  hotmart: hotmartConnector,
  kiwify: kiwifyConnector,
  eduzz: eduzzConnector,
  gumroad: gumroadConnector,
  payhip: payhipConnector,
};

export function connectorFor(provider: CommerceProvider): CommerceConnector {
  return commerceConnectors[provider];
}
