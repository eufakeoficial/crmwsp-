import { publicApiUrl } from "../channels/channels.constants.js";

/** Nest tokens for SaaS subscription charging (NOWPayments, ADR 0013). */
export const NOWPAYMENTS_PROVIDER = Symbol("NOWPAYMENTS_PROVIDER");
export const NOWPAYMENTS_IPN_SECRET = Symbol("NOWPAYMENTS_IPN_SECRET");
export const SUBSCRIPTION_QUEUE = Symbol("SUBSCRIPTION_QUEUE");
export const SUBSCRIPTION_EVENT_STORE = Symbol("SUBSCRIPTION_EVENT_STORE");

/** Public IPN callback (override with NOWPAYMENTS_IPN_URL, e.g. behind a tunnel in dev). */
export function nowPaymentsIpnUrl(): string {
  return process.env["NOWPAYMENTS_IPN_URL"] ?? `${publicApiUrl()}/webhooks/nowpayments`;
}

/** A pending invoice younger than this is reused instead of creating a new one. */
export const REUSE_PENDING_CHARGE_MS = 20 * 60_000;
