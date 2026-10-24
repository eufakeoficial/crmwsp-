/** DI token: CipherBox, or null when the master keys are not configured. */
export const CIPHER_BOX = Symbol("CIPHER_BOX");

/** DI token: the WhatsAppProvider used for template submission (overridable in tests). */
export const CHANNEL_PROVIDER = Symbol("CHANNEL_PROVIDER");

/** DI token: Dialog360PartnerClient, or null when D360_PARTNER_ID / D360_PARTNER_API_KEY are not set. */
export const DIALOG360_PARTNER = Symbol("DIALOG360_PARTNER");

/** AAD purpose of the encrypted BSP API key (same as apps/worker). Historical name, shared by every BSP. */
export const GUPSHUP_API_KEY_PURPOSE = "gupshup_api_key";

export function publicApiUrl(): string {
  const port = process.env["API_PORT"] ?? process.env["PORT"] ?? "4000";
  return (process.env["PUBLIC_API_URL"] ?? `http://localhost:${port}`).replace(/\/+$/, "");
}

export function webhookUrlFor(token: string, provider: "gupshup" | "360dialog" = "gupshup"): string {
  return `${publicApiUrl()}/webhooks/${provider}/${token}`;
}
