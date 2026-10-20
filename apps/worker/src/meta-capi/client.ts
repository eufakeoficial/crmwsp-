import { createHash } from "node:crypto";
import { minorToMajor, normalizePhoneForMeta } from "@crmwsp/domain";

/** Meta Graph API version used by every Conversions API call. Change it only here. */
export const META_GRAPH_API_VERSION = "v23.0";
export const META_GRAPH_BASE_URL = "https://graph.facebook.com";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

export interface CapiDestination {
  datasetId: string;
  /** Decrypted; never logged, never placed in the URL. */
  accessToken: string;
  testEventCode: string | null;
}

export interface CapiOutgoingEvent {
  eventId: string;
  eventName: "Lead" | "Purchase";
  eventTime: Date;
  phoneE164: string;
  ctwaClid: string | null;
  value?: { amountMinor: number; currency: string };
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function capiEventsUrl(datasetId: string): string {
  if (!/^\d{5,32}$/.test(datasetId)) throw new Error("invalid dataset id");
  return `${META_GRAPH_BASE_URL}/${META_GRAPH_API_VERSION}/${datasetId}/events`;
}

/** One server event for business messaging (Click-to-WhatsApp). */
export function buildServerEvent(e: CapiOutgoingEvent): Record<string, unknown> {
  const user_data: Record<string, unknown> = {};
  const phone = normalizePhoneForMeta(e.phoneE164);
  if (phone) user_data["ph"] = [sha256Hex(phone)];
  if (e.ctwaClid) user_data["ctwa_clid"] = e.ctwaClid;
  const ev: Record<string, unknown> = {
    event_name: e.eventName,
    event_time: Math.floor(e.eventTime.getTime() / 1000),
    event_id: e.eventId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data,
  };
  if (e.value) ev["custom_data"] = { currency: e.value.currency, value: minorToMajor(e.value.amountMinor, e.value.currency) };
  return ev;
}

export type CapiSendResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * POSTs one event. The token travels in the JSON body (not the query string) so it never lands
 * in proxy / access logs. Errors are reduced to the HTTP status and Meta's numeric error code.
 */
export async function sendCapiEvent(fetchImpl: FetchLike, dest: CapiDestination, event: CapiOutgoingEvent): Promise<CapiSendResult> {
  const body: Record<string, unknown> = { data: [buildServerEvent(event)], access_token: dest.accessToken };
  if (dest.testEventCode) body["test_event_code"] = dest.testEventCode;
  let res;
  try {
    res = await fetchImpl(capiEventsUrl(dest.datasetId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `network:${err instanceof Error ? err.name : "unknown"}` };
  }
  if (res.status >= 200 && res.status < 300) return { ok: true };
  let code = "";
  try {
    const parsed = JSON.parse(await res.text()) as { error?: { code?: unknown; error_subcode?: unknown } };
    if (typeof parsed.error?.code === "number") code = `:meta_${parsed.error.code}`;
    if (typeof parsed.error?.error_subcode === "number") code += `.${parsed.error.error_subcode}`;
  } catch {
    // body not JSON: status only
  }
  return { ok: false, status: res.status, error: `http_${res.status}${code}` };
}
