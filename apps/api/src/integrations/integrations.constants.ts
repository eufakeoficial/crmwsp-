import type { CommerceProvider } from "@crmwsp/integrations";
import { publicApiUrl } from "../channels/channels.constants.js";

/** AAD purposes (tenant-bound, see @crmwsp/crypto). One per provider so ciphertexts never cross. */
export const commerceWebhookSecretPurpose = (p: CommerceProvider) => `commerce_webhook_secret:${p}`;
export const commerceAccessTokenPurpose = (p: CommerceProvider) => `commerce_access_token:${p}`;
export const SHOPIFY_ACCESS_TOKEN_PURPOSE = commerceAccessTokenPurpose("shopify");

/** DI tokens (explicit, no reflection). */
export const COMMERCE_LEDGER = Symbol("COMMERCE_LEDGER");
export const COMMERCE_WEBHOOK_RESOLVER = Symbol("COMMERCE_WEBHOOK_RESOLVER");
export const COMMERCE_FETCH = Symbol("COMMERCE_FETCH");

export function commerceWebhookUrlFor(provider: CommerceProvider, token: string): string {
  return `${publicApiUrl()}/webhooks/commerce/${provider}/${token}`;
}
