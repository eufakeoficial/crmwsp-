/** DI token: CipherBox, or null when the master keys are not configured. */
export const CIPHER_BOX = Symbol("CIPHER_BOX");

/** AAD purpose of the encrypted Gupshup API key (same as apps/worker). */
export const GUPSHUP_API_KEY_PURPOSE = "gupshup_api_key";

export function publicApiUrl(): string {
  const port = process.env["API_PORT"] ?? process.env["PORT"] ?? "4000";
  return (process.env["PUBLIC_API_URL"] ?? `http://localhost:${port}`).replace(/\/+$/, "");
}

export function webhookUrlFor(token: string): string {
  return `${publicApiUrl()}/webhooks/gupshup/${token}`;
}
