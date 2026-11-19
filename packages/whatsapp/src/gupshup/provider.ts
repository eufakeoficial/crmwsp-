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

/**
 * Outcome of checking an API key + app name against Gupshup. `unverified` means Gupshup could not
 * answer (network, timeout, 5xx, unrecognised 4xx): callers must NOT block on it.
 */
export type GupshupCredentialCheck =
  | { status: "valid" }
  | { status: "invalid_credentials" }
  | { status: "invalid_app" }
  | { status: "unverified"; reason: string };

/** Gupshup wallet balance. `currency` is null when the response did not name one. */
export interface GupshupWalletBalance {
  amount: number;
  currency: string | null;
}

const BALANCE_KEY = /^(balance|currentbalance|walletbalance|availablebalance|amount|credits?)$/i;
const CURRENCY_KEY = /^(currency|currencycode)$/i;

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};

/**
 * Defensive parse: the documented `walletResponse` object is passed in; stay tolerant: look (up to
 * 3 levels deep) for a numeric balance-like field and a 3-letter currency. Unknown shape -> null.
 */
export function parseWalletBalance(body: unknown, depth = 0): GupshupWalletBalance | null {
  if (typeof body !== "object" || body === null || Array.isArray(body) || depth > 3) return null;
  const obj = body as Record<string, unknown>;
  let amount: number | null = null;
  let currency: string | null = null;
  for (const [k, v] of Object.entries(obj)) {
    if (amount === null && BALANCE_KEY.test(k)) amount = toNumber(v);
    if (currency === null && CURRENCY_KEY.test(k) && typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim())) currency = v.trim().toUpperCase();
  }
  if (amount !== null) return { amount, currency };
  for (const v of Object.values(obj)) {
    const nested = parseWalletBalance(v, depth + 1);
    if (nested) return nested;
  }
  return null;
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

  /**
   * Marks an inbound message as read and shows the typing indicator
   * (https://partner-docs.gupshup.io/docs/mark-message-as-readtyping-indicator).
   * Partner API only: `POST {partner}/partner/app/{appId}/v1/event` with `Authorization: <partner app token>`.
   * Without partner credentials on the channel it is a silent no-op (the `apikey` API has no such endpoint).
   */
  async sendTypingIndicator(conn: WhatsAppConnection, inboundExternalMessageId: string): Promise<void> {
    if (!conn.partnerAppId || !conn.partnerToken || !inboundExternalMessageId) return;
    await this.request(`${this.partnerBaseUrl}/partner/app/${encodeURIComponent(conn.partnerAppId)}/v1/event`, {
      method: "POST",
      headers: { authorization: conn.partnerToken, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        type: "message-event",
        message: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: inboundExternalMessageId,
          typing_indicator: { type: "text" },
        },
      }),
      redirect: "error",
    });
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

  /**
   * Read-only credential check: GET {baseUrl}/sm/api/v1/template/list/{appName} with the `apikey` header.
   * 401/403 -> invalid key; 2xx -> valid; other 4xx -> invalid app only when Gupshup's text mentions the app;
   * anything else (network, timeout, 5xx, other 4xx) -> unverified. Never logs or returns the key.
   */
  async verifyCredentials(apiKey: string, appName: string): Promise<GupshupCredentialCheck> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/sm/api/v1/template/list/${encodeURIComponent(appName)}`, {
        method: "GET",
        headers: { apikey: apiKey, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { status: "unverified", reason: "network error" };
    }
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { status: "valid" };
    }
    const detail = await gupshupErrorDetail(res);
    if (res.status === 401 || res.status === 403) return { status: "invalid_credentials" };
    if (res.status >= 400 && res.status < 500 && /app/i.test(detail)) return { status: "invalid_app" };
    return { status: "unverified", reason: `HTTP ${res.status}${detail ? `: ${detail}` : ""}` };
  }

  /**
   * Reads the wallet balance via the Partner API (documented at
   * https://partner-docs.gupshup.io/reference/get_partner-app-appid-wallet-balance):
   * GET {partnerBaseUrl}/partner/app/{appId}/wallet/balance, `Authorization: <partner app token>` (no Bearer),
   * body `{ status, walletResponse: { currency, currentBalance, overDraftLimit } }`.
   * Never throws: network errors, non-2xx and unrecognised shapes return null. Never logs the token.
   */
  async getWalletBalanceViaPartner(creds: { appId: string; partnerToken: string }): Promise<GupshupWalletBalance | null> {
    try {
      const res = await this.fetchImpl(`${this.partnerBaseUrl}/partner/app/${encodeURIComponent(creds.appId)}/wallet/balance`, {
        method: "GET",
        headers: { Authorization: creds.partnerToken, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const body: unknown = JSON.parse(await res.text());
      const wallet = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["walletResponse"] : undefined;
      return parseWalletBalance(wallet);
    } catch {
      return null;
    }
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
      const detail = await gupshupErrorDetail(res);
      throw new GupshupProviderError(`Gupshup responded with HTTP ${res.status}${detail ? `: ${detail}` : ""}`, retryable, res.status);
    }
    return res;
  }
}

/**
 * Gupshup's own short error text (e.g. "Authentication Failed", "Invalid App Details") so a failed
 * send says WHY. Only the `message` field of a JSON body, stripped to safe characters and capped:
 * the response never carries our apikey, and arbitrary bodies are not echoed.
 */
async function gupshupErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    let msg: unknown = text;
    try {
      const body: unknown = JSON.parse(text);
      msg = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["message"] : undefined;
    } catch {
      // Plain-text body (e.g. "Portal User Not Found With APIKey"): use it as is.
    }
    if (typeof msg !== "string") return "";
    return msg.replace(/[^\p{L}\p{N} .,:_'()-]/gu, "").trim().slice(0, 120);
  } catch {
    return "";
  }
}
