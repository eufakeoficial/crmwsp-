import type { WebhookHeaders, WhatsAppProvider } from "./provider.js";
import type {
  DownloadedMedia,
  InboundMedia,
  InboundWebhookResult,
  OutboundMedia,
  ProviderTemplate,
  ReactionRequest,
  SendOptions,
  SendResult,
  SubmitTemplateResult,
  TemplateSubmission,
  WhatsAppConnection,
} from "./types.js";

/** Header consumers set on `parseWebhook` to say which BSP produced the payload (inbound_events.provider). */
export const BSP_HEADER = "x-bsp";

export type BspName = NonNullable<WhatsAppConnection["provider"]>;

/**
 * Dispatches every call to the adapter of the connection's BSP (`conn.provider`, default gupshup).
 * Lets the worker and API keep a single `WhatsAppProvider` while channels of several BSPs coexist.
 */
export class RoutingWhatsAppProvider implements WhatsAppProvider {
  readonly name = "router";

  constructor(
    private readonly adapters: Record<BspName, WhatsAppProvider>,
    private readonly fallback: BspName = "gupshup",
  ) {}

  private pick(name: string | undefined): WhatsAppProvider {
    const key = name === "gupshup" || name === "360dialog" ? name : this.fallback;
    return this.adapters[key];
  }

  private for(conn: WhatsAppConnection): WhatsAppProvider {
    return this.pick(conn.provider);
  }

  parseWebhook(body: unknown, headers: WebhookHeaders): InboundWebhookResult[] {
    return this.pick(headers[BSP_HEADER]).parseWebhook(body, headers);
  }
  sendText(conn: WhatsAppConnection, to: string, text: string, opts?: SendOptions): Promise<SendResult> {
    return this.for(conn).sendText(conn, to, text, opts);
  }
  sendMedia(conn: WhatsAppConnection, to: string, media: OutboundMedia): Promise<SendResult> {
    return this.for(conn).sendMedia(conn, to, media);
  }
  sendTemplate(conn: WhatsAppConnection, to: string, templateId: string, params: string[]): Promise<SendResult> {
    return this.for(conn).sendTemplate(conn, to, templateId, params);
  }
  sendReaction(conn: WhatsAppConnection, req: ReactionRequest): Promise<SendResult> {
    return this.for(conn).sendReaction(conn, req);
  }
  downloadMedia(conn: WhatsAppConnection, media: InboundMedia): Promise<DownloadedMedia> {
    return this.for(conn).downloadMedia(conn, media);
  }
  submitTemplate(conn: WhatsAppConnection, tpl: TemplateSubmission): Promise<SubmitTemplateResult> {
    return this.for(conn).submitTemplate(conn, tpl);
  }
  listTemplates(conn: WhatsAppConnection): Promise<ProviderTemplate[]> {
    return this.for(conn).listTemplates(conn);
  }
}
