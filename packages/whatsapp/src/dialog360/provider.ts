import { ExternalProviderError } from "@crmwsp/contracts";
import type { WebhookHeaders, WhatsAppProvider } from "../provider.js";
import { parseV3 } from "../gupshup/parse.js";
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
import { mediaUrlResponseSchema, sendResponseSchema, templateListResponseSchema, templateSubmitResponseSchema } from "./schemas.js";

/*
 * 360dialog Cloud API adapter (https://docs.360dialog.com/docs/waba-messaging).
 * - Base URL https://waba-v2.360dialog.io, header `D360-API-KEY: <channel api key>`.
 * - Send: POST /messages (JSON, Cloud API body) -> { messages: [{ id }] }.
 * - Media: GET /{media-id} -> { url }. The url points to Meta's CDN host; 360dialog requires fetching it
 *   through its own host, so only path+query are kept and re-rooted on baseUrl (SSRF-safe by construction).
 * - Templates: GET|POST /v1/configs/templates. 360dialog identifies templates by name+language, so the
 *   `externalId` we store is `name|language` (see templateExternalId).
 * - Webhooks: Meta's WhatsApp Business webhook body, forwarded unchanged. 360dialog does not sign callbacks
 *   either; authenticity is the opaque per-connection token in the URL (/webhooks/360dialog/:token).
 */

export interface Dialog360ProviderOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Max media download size in bytes (default 25 MiB). */
  maxMediaBytes?: number;
}

/** ExternalProviderError carrying retry semantics. Never contains credentials or request bodies. */
export class Dialog360ProviderError extends ExternalProviderError {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, retryable: boolean, status?: number) {
    super("360dialog", message, status === undefined ? undefined : { details: { status } });
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
  }
}

export const templateExternalId = (name: string, language: string): string => `${name}|${language}`;

export function parseTemplateExternalId(externalId: string): { name: string; language: string } | undefined {
  const i = externalId.lastIndexOf("|");
  if (i <= 0 || i === externalId.length - 1) return undefined;
  return { name: externalId.slice(0, i), language: externalId.slice(i + 1) };
}

function mapTemplateStatus(raw: string | undefined): ProviderTemplateStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
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
      return "utility";
    case "AUTHENTICATION":
      return "authentication";
    default:
      return "marketing";
  }
}

const digits = (phone: string): string => phone.replace(/^\+/, "");

/** Samples for `{{n}}` placeholders in the template body (Meta requires them). */
function bodySamples(body: string, example: string | undefined): string[] {
  const count = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
  if (count === 0) return [];
  const out: string[] = [];
  if (example) {
    // Re-extract the values of the example by matching the body pattern.
    const re = new RegExp(
      `^${body.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\{\d+\}\}/g, "(.+?)")}$`,
      "s",
    );
    const m = re.exec(example);
    if (m) for (let i = 1; i <= count; i++) out.push(m[i] ?? "sample");
  }
  while (out.length < count) out.push("sample");
  return out;
}

export class Dialog360Provider implements WhatsAppProvider {
  readonly name = "360dialog";
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxMediaBytes: number;

  constructor(options: Dialog360ProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? "https://waba-v2.360dialog.io").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxMediaBytes = options.maxMediaBytes ?? 25 * 1024 * 1024;
  }

  parseWebhook(body: unknown, _headers: WebhookHeaders): InboundWebhookResult[] {
    try {
      if (typeof body !== "object" || body === null) return [{ kind: "ignored", reason: "non-object body" }];
      if ((body as Record<string, unknown>)["object"] !== "whatsapp_business_account") {
        return [{ kind: "ignored", reason: "unknown payload shape" }];
      }
      return parseV3(body);
    } catch {
      return [{ kind: "ignored", reason: "parse error" }];
    }
  }

  sendText(conn: WhatsAppConnection, to: string, text: string, opts: SendOptions = {}): Promise<SendResult> {
    const body: Record<string, unknown> = { type: "text", text: { body: text } };
    if (opts.previewUrl !== undefined) (body["text"] as Record<string, unknown>)["preview_url"] = opts.previewUrl;
    return this.send(conn, to, body);
  }

  sendMedia(conn: WhatsAppConnection, to: string, media: OutboundMedia): Promise<SendResult> {
    const content: Record<string, unknown> = { link: media.url };
    if (media.caption !== undefined && media.type !== "audio") content["caption"] = media.caption;
    if (media.type === "document") content["filename"] = media.filename ?? "file";
    return this.send(conn, to, { type: media.type, [media.type]: content });
  }

  sendTemplate(conn: WhatsAppConnection, to: string, templateId: string, params: string[]): Promise<SendResult> {
    const ref = parseTemplateExternalId(templateId);
    if (!ref) throw new Dialog360ProviderError("Invalid 360dialog template reference", false);
    const template: Record<string, unknown> = { name: ref.name, language: { code: ref.language } };
    if (params.length > 0) {
      template["components"] = [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }];
    }
    return this.send(conn, to, { type: "template", template });
  }

  sendReaction(conn: WhatsAppConnection, req: ReactionRequest): Promise<SendResult> {
    return this.send(conn, req.to, { type: "reaction", reaction: { message_id: req.messageExternalId, emoji: req.emoji } });
  }

  async submitTemplate(conn: WhatsAppConnection, tpl: TemplateSubmission): Promise<SubmitTemplateResult> {
    const bodyComponent: Record<string, unknown> = { type: "BODY", text: tpl.body };
    const samples = bodySamples(tpl.body, tpl.example);
    if (samples.length > 0) bodyComponent["example"] = { body_text: [samples] };
    const res = await this.request(`${this.baseUrl}/v1/configs/templates`, {
      method: "POST",
      headers: this.headers(conn, true),
      body: JSON.stringify({
        name: tpl.name,
        language: tpl.language,
        category: tpl.category.toUpperCase(),
        components: [bodyComponent],
      }),
      redirect: "error",
    });
    const parsed = templateSubmitResponseSchema.safeParse(await this.readJson(res));
    if (!parsed.success) throw new Dialog360ProviderError("Unexpected template response from 360dialog", false, res.status);
    return { externalId: templateExternalId(tpl.name, tpl.language), status: mapTemplateStatus(parsed.data.status) };
  }

  async listTemplates(conn: WhatsAppConnection): Promise<ProviderTemplate[]> {
    const res = await this.request(`${this.baseUrl}/v1/configs/templates?limit=1000`, {
      method: "GET",
      headers: this.headers(conn, false),
      redirect: "error",
    });
    const parsed = templateListResponseSchema.safeParse(await this.readJson(res));
    if (!parsed.success) throw new Dialog360ProviderError("Unexpected template list response from 360dialog", false, res.status);
    return parsed.data.waba_templates.map((t) => ({
      externalId: templateExternalId(t.name, t.language),
      name: t.name,
      language: t.language,
      category: mapTemplateCategory(t.category),
      status: mapTemplateStatus(t.status),
      body: t.components?.find((c) => c.type.toUpperCase() === "BODY")?.text ?? "",
      ...(t.rejected_reason && t.rejected_reason !== "NONE" ? { reason: t.rejected_reason.slice(0, 200) } : {}),
    }));
  }

  async downloadMedia(conn: WhatsAppConnection, media: InboundMedia): Promise<DownloadedMedia> {
    const mediaId = media.externalMediaId ?? media.url;
    if (!mediaId || !/^[A-Za-z0-9_-]{1,256}$/.test(mediaId)) throw new Dialog360ProviderError("Media has no valid id", false);

    const meta = await this.request(`${this.baseUrl}/${mediaId}`, {
      method: "GET",
      headers: this.headers(conn, false),
      redirect: "error",
    });
    const parsed = mediaUrlResponseSchema.safeParse(await this.readJson(meta));
    if (!parsed.success) throw new Dialog360ProviderError("Unexpected media response from 360dialog", false, meta.status);
    let source: URL;
    try {
      source = new URL(parsed.data.url);
    } catch {
      throw new Dialog360ProviderError("Invalid media URL", false);
    }
    // Re-root on our own host: the API key is only ever sent to baseUrl.
    const res = await this.request(`${this.baseUrl}${source.pathname}${source.search}`, {
      method: "GET",
      headers: this.headers(conn, false),
      redirect: "error",
    });
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxMediaBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new Dialog360ProviderError("Media exceeds size limit", false);
    }
    let data: Uint8Array;
    try {
      data = await this.readLimited(res);
    } catch (e) {
      if (e instanceof Dialog360ProviderError) throw e;
      throw new Dialog360ProviderError("Network error downloading media", true);
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
        throw new Dialog360ProviderError("Media exceeds size limit", false);
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

  private headers(conn: WhatsAppConnection, json: boolean): Record<string, string> {
    return {
      "D360-API-KEY": conn.apiKey,
      accept: "application/json",
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }

  private async send(conn: WhatsAppConnection, to: string, message: Record<string, unknown>): Promise<SendResult> {
    const res = await this.request(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.headers(conn, true),
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), ...message }),
    });
    const parsed = sendResponseSchema.safeParse(await this.readJson(res));
    const id = parsed.success ? parsed.data.messages[0]?.id : undefined;
    if (!id) throw new Dialog360ProviderError("360dialog rejected the message", false, res.status);
    return { externalId: id };
  }

  private async readJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new Dialog360ProviderError("Invalid JSON response from 360dialog", true, res.status);
    }
  }

  /** Performs the request; maps network errors and non-2xx to Dialog360ProviderError. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      // Do not attach `cause`: it may embed request details.
      throw new Dialog360ProviderError("Network error calling 360dialog", true);
    }
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new Dialog360ProviderError(`360dialog responded with HTTP ${res.status}`, retryable, res.status);
    }
    return res;
  }
}
