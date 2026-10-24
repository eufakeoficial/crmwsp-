import { z } from "zod";
import { Dialog360ProviderError } from "./provider.js";

/*
 * 360dialog Partner (Hub) API used by the Connect / Embedded Signup (Coexistence) onboarding.
 * - POST {hub}/partners/{partnerId}/channels/{channelId}/api_keys -> { api_key }   (shown once; regenerating revokes)
 * - GET  {hub}/partners/{partnerId}/channels?filters={"id":"<channelId>"}          -> channel details (phone number)
 * - POST {waba}/v1/configs/webhook  { url }  with D360-API-KEY                     -> sets the channel webhook
 * The Partner API credentials come from env (D360_PARTNER_ID / D360_PARTNER_API_KEY) and are never logged.
 * Endpoint shapes follow the Partner API reference; verify them against the sandbox before going live.
 */

export interface Dialog360PartnerOptions {
  partnerId: string;
  partnerApiKey: string;
  fetch?: typeof globalThis.fetch;
  hubUrl?: string;
  wabaUrl?: string;
  timeoutMs?: number;
}

const apiKeyResponseSchema = z.object({ api_key: z.string().min(8).max(512) }).loose();

const channelsResponseSchema = z
  .object({
    partner_channels: z.array(z.record(z.string(), z.unknown())).optional(),
    channels: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .loose();

const PHONE_KEYS = ["display_phone_number", "phone_number", "phone"] as const;

/** Looks for a phone-like string in the channel record (top level, `setup_info`, `address`). */
export function extractChannelPhone(channel: Record<string, unknown>): string | undefined {
  const sources: Array<Record<string, unknown>> = [channel];
  for (const k of ["setup_info", "address"] as const) {
    const v = channel[k];
    if (v && typeof v === "object") sources.push(v as Record<string, unknown>);
  }
  for (const src of sources) {
    for (const k of PHONE_KEYS) {
      const v = src[k];
      if (typeof v !== "string") continue;
      const digits = v.replace(/[^\d]/g, "");
      if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    }
  }
  return undefined;
}

export interface Dialog360ChannelInfo {
  id: string;
  clientId?: string;
  phone?: string;
}

/** Client id of a Hub channel record (`client_id`, or `client.id`). */
export function extractChannelClientId(channel: Record<string, unknown>): string | undefined {
  const direct = channel["client_id"];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const client = channel["client"];
  if (client && typeof client === "object") {
    const id = (client as Record<string, unknown>)["id"];
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

export class Dialog360PartnerClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly hubUrl: string;
  private readonly wabaUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: Dialog360PartnerOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.hubUrl = (opts.hubUrl ?? "https://hub.360dialog.com/api/v2").replace(/\/+$/, "");
    this.wabaUrl = (opts.wabaUrl ?? "https://waba-v2.360dialog.io").replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** Creates (and returns, once) the channel API key. */
  async createChannelApiKey(channelId: string): Promise<string> {
    const res = await this.call(`${this.hubUrl}/partners/${encodeURIComponent(this.opts.partnerId)}/channels/${encodeURIComponent(channelId)}/api_keys`, {
      method: "POST",
      headers: { "x-api-key": this.opts.partnerApiKey, accept: "application/json" },
    });
    const parsed = apiKeyResponseSchema.safeParse(await this.json(res));
    if (!parsed.success) throw new Dialog360ProviderError("Unexpected API key response from 360dialog", false, res.status);
    return parsed.data.api_key;
  }

  /** Best-effort phone lookup (E.164). Undefined when the Hub does not expose it. */
  async findChannelPhone(channelId: string): Promise<string | undefined> {
    try {
      const filters = encodeURIComponent(JSON.stringify({ id: channelId }));
      const res = await this.call(`${this.hubUrl}/partners/${encodeURIComponent(this.opts.partnerId)}/channels?filters=${filters}`, {
        method: "GET",
        headers: { "x-api-key": this.opts.partnerApiKey, accept: "application/json" },
      });
      const parsed = channelsResponseSchema.safeParse(await this.json(res));
      if (!parsed.success) return undefined;
      const list = parsed.data.partner_channels ?? parsed.data.channels ?? [];
      const match = list.find((c) => c["id"] === channelId) ?? list[0];
      return match ? extractChannelPhone(match) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Channel details for ownership checks: the client it belongs to and its phone. Undefined when the
   * Hub does not know the channel under this partner. Errors propagate (callers must fail closed).
   */
  async getChannel(channelId: string): Promise<Dialog360ChannelInfo | undefined> {
    const filters = encodeURIComponent(JSON.stringify({ id: channelId }));
    const res = await this.call(`${this.hubUrl}/partners/${encodeURIComponent(this.opts.partnerId)}/channels?filters=${filters}`, {
      method: "GET",
      headers: { "x-api-key": this.opts.partnerApiKey, accept: "application/json" },
    });
    const parsed = channelsResponseSchema.safeParse(await this.json(res));
    if (!parsed.success) throw new Dialog360ProviderError("Unexpected channels response from 360dialog", false, res.status);
    const list = parsed.data.partner_channels ?? parsed.data.channels ?? [];
    // Exact id match only: never fall back to "the first channel" for an ownership decision.
    const match = list.find((c) => c["id"] === channelId);
    if (!match) return undefined;
    const clientId = extractChannelClientId(match);
    const phone = extractChannelPhone(match);
    return { id: channelId, ...(clientId ? { clientId } : {}), ...(phone ? { phone } : {}) };
  }

  /** Points the channel's webhook at our URL (contains the opaque per-connection token). */
  async setWebhook(channelApiKey: string, url: string): Promise<void> {
    await this.call(`${this.wabaUrl}/v1/configs/webhook`, {
      method: "POST",
      headers: { "D360-API-KEY": channelApiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ url }),
    });
  }

  private async json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new Dialog360ProviderError("Invalid JSON response from 360dialog", true, res.status);
    }
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new Dialog360ProviderError("Network error calling 360dialog", true);
    }
    if (!res.ok) {
      throw new Dialog360ProviderError(`360dialog responded with HTTP ${res.status}`, res.status >= 500 || res.status === 429, res.status);
    }
    return res;
  }
}
