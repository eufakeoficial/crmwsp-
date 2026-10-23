import { ExternalProviderError } from "@crmwsp/contracts";
import type { WebhookHeaders, WhatsAppProvider } from "../provider.js";
import type {
  DownloadedMedia,
  InboundMedia,
  InboundWebhookResult,
  OutboundMedia,
  ProviderTemplate,
  ProviderTemplateCategory,
  ProviderTemplateStatus,
  ReactionRequest,
  SendOptions,
  SendResult,
  SubmitTemplateResult,
  TemplateSubmission,
  WhatsAppConnection,
} from "../types.js";
import { parseGupshupWebhook } from "./parse.js";
import { sendResponseSchema, templateListResponseSchema, templateSubmitResponseSchema } from "./schemas.js";

/*
 * Gupshup WhatsApp API adapter.
 * - Session messages: POST {baseUrl}/wa/api/v1/msg  (https://docs.gupshup.io/docs/session-messages)
 * - Templates:        POST {baseUrl}/wa/api/v1/template/msg (https://docs.gupshup.io/docs/template-messages)
 * - Template review:  POST|GET {partnerBaseUrl}/partner/app/{appId}/templates (Partner API, ADR 0004;
 *   https://docs.gupshup.io/reference/post_partner-app-appid-templates). Form-encoded, authenticated
 *   with `Authorization: <partner app token>` (NOT `apikey`); redirects are refused.
 * Both sends are application/x-www-form-urlencoded with header `apikey`, and answer
 * `{ "status": "submitted", "messageId": "<gupshup id>" }`. Delivery is async; status
 * comes back through "message-event" callbacks keyed by that id.
 *
 * Webhook authentication: Gupshup does not document any signature (HMAC or other)
 * on its callbacks. Authenticity is therefore enforced by the caller with an opaque
 * per-connection token in the callback URL (see ../webhook-token.ts) compared in constant
 * time, plus the strict Zod validation done here. `parseWebhook` ignores headers.
 */

export interface GupshupProviderOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  /** Partner API host (templates). Default https://partner.gupshup.io. */
  partnerBaseUrl?: string;
  /** Hosts (exact or dot-suffix) from which media may be downloaded. */
  mediaHosts?: string[];
  timeoutMs?: number;
  /** Max media download size in bytes (default 25 MiB). */
  maxMediaBytes?: number;
}

/** ExternalProviderError carrying retry semantics. Never contains credentials or request bodies. */
export class GupshupProviderError extends ExternalProviderError {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, retryable: boolean, status?: number) {
    super("gupshup", message, status === undefined ? undefined : { details: { status } });
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
  }
}

const DEFAULT_MEDIA_HOSTS = ["gupshup.io"];

/** Unknown statuses map to "pending": a template is only sendable once explicitly approved. */
function mapTemplateStatus(raw: string | undefined): ProviderTemplateStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
    case "FAILED":
      return "rejected";
    case "PAUSED":
    case "FLAGGED":
      return "paused";
    case "DISABLED":
    case "DELETED":
      return "disabled";
    default:
      return "pending";
  }
}

function mapTemplateCategory(raw: string | undefined): ProviderTemplateCategory {
  switch ((raw ?? "").toUpperCase()) {
    case "UTILITY":
    case "TRANSACTIONAL":
      return "utility";
    case "AUTHENTICATION":
    case "OTP":
      return "authentication";
    default:
      return "marketing";
  }
}

export class GupshupProvider implements WhatsAppProvider {
  readonly name = "gupshup";
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly partnerBaseUrl: string;
  private readonly mediaHosts: string[];
  private readonly timeoutMs: number;
  private readonly maxMediaBytes: number;

  constructor(options: GupshupProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.gupshup.io").replace(/\/+$/, "");
    this.partnerBaseUrl = (options.partnerBaseUrl ?? "https://partner.gupshup.io").replace(/\/+$/, "");
    this.mediaHosts = options.mediaHosts ?? DEFAULT_MEDIA_HOSTS;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxMediaBytes = options.maxMediaBytes ?? 25 * 1024 * 1024;
  }

  parseWebhook(body: unknown, _headers: WebhookHeaders): InboundWebhookResult[] {
    return parseGupshupWebhook(body);
  }

  sendText(conn: WhatsAppConnection, to: string, text: string, opts: SendOptions = {}): Promise<SendResult> {
    const message: Record<string, unknown> = { type: "text", text };
    if (opts.previewUrl !== undefined) message.previewUrl = opts.previewUrl;
    return this.post(conn, "/wa/api/v1/msg", {
      ...this.common(conn, to),
      message: JSON.stringify(message),
    });
  }

  sendMedia(conn: WhatsAppConnection, to: string, media: OutboundMedia): Promise<SendResult> {
    let message: Record<string, unknown>;
    switch (media.type) {
      case "image":
        message = { type: "image", originalUrl: media.url, previewUrl: media.url };
        break;
      case "document":
        message = { type: "file", url: media.url, filename: media.filename ?? "file" };
        break;
      default:
        message = { type: media.type, url: media.url };
    }
    if (media.caption !== undefined && media.type !== "audio") message.caption = media.caption;
    return this.post(conn, "/wa/api/v1/msg", {
      ...this.common(conn, to),
      message: JSON.stringify(message),
    });
  }

  sendTemplate(conn: WhatsAppConnection, to: string, templateId: string, params: string[]): Promise<SendResult> {
    return this.post(conn, "/wa/api/v1/template/msg", {
      ...this.common(conn, to),
      template: JSON.stringify({ id: templateId, params }),
    });
  }

  /** Session message of type "reaction" (https://docs.gupshup.io/docs/outbound-reactions). */
  sendReaction(conn: WhatsAppConnection, req: ReactionRequest): Promise<SendResult> {
    return this.post(conn, "/wa/api/v1/msg", {
      ...this.common(conn, req.to),
      message: JSON.stringify({ type: "reaction", msgId: req.messageExternalId, emoji: req.emoji }),
    });
  }

  /** Applies for a template (Meta review). Gupshup answers `{status:"success", template:{id,status}}`. */
  async submitTemplate(conn: WhatsAppConnection, tpl: TemplateSubmission): Promise<SubmitTemplateResult> {
    const form: Record<string, string> = {
      elementName: tpl.name,
      languageCode: tpl.language,
      category: tpl.category.toUpperCase(),
      templateType: "TEXT",
      vertical: "CRM",
      content: tpl.body,
      example: tpl.example ?? tpl.body,
    };
    const { url, token } = this.partnerTemplates(conn);
    const res = await this.request(url, {
      method: "POST",
      headers: {
        authorization: token,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
      redirect: "error",
    });
    const json = await this.readJson(res);
    const parsed = templateSubmitResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.status !== "success" || !parsed.data.template) {
      throw new GupshupProviderError("Gupshup rejected the template", false, res.status);
    }
    return { externalId: parsed.data.template.id, status: mapTemplateStatus(parsed.data.template.status) };
  }

  async listTemplates(conn: WhatsAppConnection): Promise<ProviderTemplate[]> {
    const { url, token } = this.partnerTemplates(conn);
    const res = await this.request(url, {
      method: "GET",
      headers: { authorization: token, accept: "application/json" },
      redirect: "error",
    });
    const json = await this.readJson(res);
    const parsed = templateListResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.status !== "success") {
      throw new GupshupProviderError("Unexpected template list response from Gupshup", false, res.status);
    }
    return parsed.data.templates.map((t) => ({
      externalId: t.id,
      name: t.elementName,
      language: t.languageCode,
      category: mapTemplateCategory(t.category),
      status: mapTemplateStatus(t.status),
      body: t.data ?? "",
      ...(t.reason ? { reason: t.reason.slice(0, 200) } : {}),
    }));
  }

  /** Partner API templates URL + app token. Throws (non-retryable) when the channel has no partner credentials. */
  private partnerTemplates(conn: WhatsAppConnection): { url: string; token: string } {
    if (!conn.partnerAppId || !conn.partnerToken) {
      throw new GupshupProviderError("Channel has no Gupshup partner credentials", false);
    }
    return { url: `${this.partnerBaseUrl}/partner/app/${encodeURIComponent(conn.partnerAppId)}/templates`, token: conn.partnerToken };
  }

  private async readJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new GupshupProviderError("Invalid JSON response from Gupshup", true, res.status);
    }
  }

  async downloadMedia(conn: WhatsAppConnection, media: InboundMedia): Promise<DownloadedMedia> {
    if (!media.url) throw new GupshupProviderError("Media has no downloadable URL", false);
    let url: URL;
    try {
      url = new URL(media.url);
    } catch {
      throw new GupshupProviderError("Invalid media URL", false);
    }
    // SSRF guard: only https on the default port to known Gupshup hosts, no userinfo,
    // and redirects are refused so the apikey never leaves the allowlist.
    const host = url.hostname.toLowerCase();
    const allowed = this.mediaHosts.some((h) => {
      const hh = h.toLowerCase();
      return host === hh || host.endsWith(`.${hh}`);
    });
    if (url.protocol !== "https:" || !allowed || url.username !== "" || url.password !== "" || url.port !== "") {
      throw new GupshupProviderError("Media host not allowed", false);
    }

    const res = await this.request(url.toString(), {
      method: "GET",
      headers: { apikey: conn.apiKey },
      redirect: "error",
    });
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxMediaBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new GupshupProviderError("Media exceeds size limit", false);
    }
    let data: Uint8Array;
    try {
      data = await this.readLimited(res);
    } catch (e) {
      if (e instanceof GupshupProviderError) throw e;
      throw new GupshupProviderError("Network error downloading media", true);
    }
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || media.mimeType || "application/octet-stream";
    return { data, mimeType };
  }

  private async readLimited(res: Response): Promise<Uint8Array> {
    if (!res.body) return new Uint8Array(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxMediaBytes) {
        await reader.cancel().catch(() => undefined);
        throw new GupshupProviderError("Media exceeds size limit", false);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }

  private common(conn: WhatsAppConnection, to: string): Record<string, string> {
    return {
      channel: "whatsapp",
      source: conn.sourcePhone.replace(/^\+/, ""),
      destination: to.replace(/^\+/, ""),
      "src.name": conn.appName,
    };
  }

  private async post(conn: WhatsAppConnection, path: string, form: Record<string, string>): Promise<SendResult> {
    const res = await this.request(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        apikey: conn.apiKey,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
    });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new GupshupProviderError("Invalid JSON response from Gupshup", true, res.status);
    }
    const parsed = sendResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.status !== "submitted" || !parsed.data.messageId) {
      throw new GupshupProviderError("Gupshup rejected the message", false, res.status);
    }
    return { externalId: parsed.data.messageId };
  }

  /** Performs the request; maps network errors and non-2xx to GupshupProviderError. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      // Do not attach `cause`: it may embed request details.
      throw new GupshupProviderError("Network error calling Gupshup", true);
    }
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new GupshupProviderError(`Gupshup responded with HTTP ${res.status}`, retryable, res.status);
    }
    return res;
  }
}
