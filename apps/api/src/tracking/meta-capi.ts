import { createHash } from "node:crypto";

/** Nest injection token of the Meta Conversions API sender (null when not configured). */
export const META_CAPI = Symbol("META_CAPI");

const GRAPH_VERSION = "v21.0";
const TIMEOUT_MS = 5_000;

export interface RegistrationEvent {
  eventId: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
  fbp?: string | undefined;
  fbc?: string | undefined;
  /** Unix seconds; defaults to now. */
  eventTime?: number;
}

export interface MetaCapi {
  /** Fire-and-forget: resolves when settled, never rejects, never throws. */
  sendCompleteRegistration(event: RegistrationEvent): Promise<void>;
}

/** Meta requires lowercase, trimmed values hashed with SHA-256 (hex). */
export function hashForMeta(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function buildRegistrationPayload(event: RegistrationEvent): { data: Record<string, unknown>[] } {
  const userData: Record<string, unknown> = { em: [hashForMeta(event.email)] };
  if (event.ip) userData["client_ip_address"] = event.ip;
  if (event.userAgent) userData["client_user_agent"] = event.userAgent;
  if (event.fbp) userData["fbp"] = event.fbp;
  if (event.fbc) userData["fbc"] = event.fbc;
  return {
    data: [
      {
        event_name: "CompleteRegistration",
        event_time: event.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        action_source: "website",
        user_data: userData,
      },
    ],
  };
}

export function createMetaCapi(
  pixelId: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  onError: (reason: string) => void = () => undefined,
): MetaCapi {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events`;
  return {
    async sendCompleteRegistration(event) {
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(buildRegistrationPayload(event)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // Only the status is reported: never the token, the email or the response body.
        if (!res.ok) onError(`http_${res.status}`);
      } catch (err) {
        onError(err instanceof Error ? err.name : "unknown");
      }
    },
  };
}

/** `null` (no-op) unless both META_PIXEL_ID and META_CAPI_TOKEN are set. */
export function createMetaCapiFromEnv(env: NodeJS.ProcessEnv = process.env, onError?: (reason: string) => void): MetaCapi | null {
  const pixelId = env["META_PIXEL_ID"]?.trim();
  const token = env["META_CAPI_TOKEN"]?.trim();
  if (!pixelId || !token) return null;
  return createMetaCapi(pixelId, token, fetch, onError);
}
