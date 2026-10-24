/** Helpers for the 360dialog Connect (Embedded Signup, Coexistence) flow. */

/** Path of the page that receives the Connect redirect (relative to the app origin). */
export const DIALOG360_CALLBACK_PATH = "/app/channels/360dialog/callback";

/** Partner Connect URL: 360dialog sends the user back to `redirectUrl` once the number is connected. */
export function buildDialog360ConnectUrl(partnerId: string, origin: string, state?: string): string {
  const redirect = encodeURIComponent(`${origin.replace(/\/+$/, "")}${DIALOG360_CALLBACK_PATH}`);
  const base = `https://hub.360dialog.com/dashboard/app/${encodeURIComponent(partnerId)}/permissions?redirect_url=${redirect}`;
  return state ? `${base}&state=${encodeURIComponent(state)}` : base;
}

/** sessionStorage key of the server-issued connect state (fallback when the Hub drops `state`). */
export const DIALOG360_STATE_KEY = "crmwsp.d360.state";

export interface Dialog360CallbackParams {
  clientId?: string;
  channelIds: string[];
  state?: string;
}

/**
 * Reads the Connect redirect query: `client=<id>&channels=[<id>,<id>]`. The channels list may come
 * bracketed, quoted or comma separated; only ids made of [A-Za-z0-9_-] are kept.
 */
export function parseDialog360Callback(search: string | URLSearchParams): Dialog360CallbackParams {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = params.get("channels") ?? "";
  const channelIds = raw
    .replace(/[[\]"']/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{1,128}$/.test(s));
  const client = params.get("client")?.trim();
  const state = params.get("state")?.trim();
  return {
    ...(client ? { clientId: client } : {}),
    channelIds: [...new Set(channelIds)],
    ...(state && /^[A-Za-z0-9_-]{32,128}$/.test(state) ? { state } : {}),
  };
}
