import { publicApiUrl } from "../channels/channels.constants.js";

/** AAD purposes of the encrypted Stripe secrets (tenant-bound, see @crmwsp/crypto). */
export const STRIPE_SECRET_KEY_PURPOSE = "stripe_secret_key";
export const STRIPE_WEBHOOK_SECRET_PURPOSE = "stripe_webhook_secret";

/** DI tokens (explicit, no reflection). */
export const PAYMENT_LEDGER = Symbol("PAYMENT_LEDGER");
export const STRIPE_WEBHOOK_RESOLVER = Symbol("STRIPE_WEBHOOK_RESOLVER");
export const STRIPE_PROVIDER_FACTORY = Symbol("STRIPE_PROVIDER_FACTORY");
export const PAYMENTS_CLOCK = Symbol("PAYMENTS_CLOCK");

export function stripeWebhookUrlFor(token: string): string {
  return `${publicApiUrl()}/webhooks/stripe/${token}`;
}
