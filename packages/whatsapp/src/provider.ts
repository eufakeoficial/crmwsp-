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

export type WebhookHeaders = Record<string, string | undefined>;

/**
 * Port every BSP adapter implements. Implementations must never log nor include
 * credentials (`conn.apiKey`) in thrown errors.
 */
export interface WhatsAppProvider {
  readonly name: string;
  /** Never throws: unknown or malformed payloads yield `{ kind: "ignored" }`. */
  parseWebhook(body: unknown, headers: WebhookHeaders): InboundWebhookResult[];
  sendText(conn: WhatsAppConnection, to: string, text: string, opts?: SendOptions): Promise<SendResult>;
  sendMedia(conn: WhatsAppConnection, to: string, media: OutboundMedia): Promise<SendResult>;
  sendTemplate(conn: WhatsAppConnection, to: string, templateId: string, params: string[]): Promise<SendResult>;
  /** Reacts to an inbound message with an emoji (WhatsApp reaction message). */
  sendReaction(conn: WhatsAppConnection, req: ReactionRequest): Promise<SendResult>;
  downloadMedia(conn: WhatsAppConnection, media: InboundMedia): Promise<DownloadedMedia>;
  /** Submits a template to Meta review through the BSP. Resolves with the BSP template id and initial status. */
  submitTemplate(conn: WhatsAppConnection, tpl: TemplateSubmission): Promise<SubmitTemplateResult>;
  /** Lists every template of the connection with its current review status. */
  listTemplates(conn: WhatsAppConnection): Promise<ProviderTemplate[]>;
  /**
   * Optional: marks the inbound message as read and shows "typing..." to the customer (WhatsApp Cloud API
   * typing indicator). The BSP dismisses it after ~25 s or when we reply. Best effort: adapters without
   * support omit it; callers must catch errors and never let this block a reply.
   */
  sendTypingIndicator?(conn: WhatsAppConnection, inboundExternalMessageId: string): Promise<void>;
}
