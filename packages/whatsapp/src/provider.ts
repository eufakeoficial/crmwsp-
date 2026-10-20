import type {
  DownloadedMedia,
  InboundMedia,
  InboundWebhookResult,
  OutboundMedia,
  ReactionRequest,
  SendOptions,
  SendResult,
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
}
