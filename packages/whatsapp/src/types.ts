/** BSP-independent shapes used by the rest of the system. */

export type InboundMessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "location"
  | "interactive"
  | "unsupported";

export interface InboundMedia {
  externalMediaId?: string;
  url?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
}

export interface InboundLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface NormalizedInboundMessage {
  externalId: string;
  /** E.164 sender phone. */
  from: string;
  to?: string;
  timestamp: Date;
  type: InboundMessageType;
  text?: string;
  media?: InboundMedia;
  location?: InboundLocation;
  contactName?: string;
  raw: unknown;
}

export type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export interface NormalizedStatusUpdate {
  externalId: string;
  status: DeliveryStatus;
  timestamp: Date;
  error?: { code: string; message: string };
}

export type InboundWebhookResult =
  | { kind: "message"; dedupeKey: string; message: NormalizedInboundMessage }
  | { kind: "status"; dedupeKey: string; status: NormalizedStatusUpdate }
  | { kind: "ignored"; reason: string };

/** Decrypted per-channel credentials. Never logged nor embedded in errors. */
export interface WhatsAppConnection {
  apiKey: string;
  appName: string;
  /** Business phone, E.164 (with or without leading "+"). */
  sourcePhone: string;
}

export type OutboundMediaType = "image" | "audio" | "video" | "document";

export interface OutboundMedia {
  type: OutboundMediaType;
  url: string;
  caption?: string;
  filename?: string;
}

export interface SendOptions {
  /** Disable link previews for text messages. */
  previewUrl?: boolean;
}

export interface SendResult {
  externalId: string;
}

export interface DownloadedMedia {
  data: Uint8Array;
  mimeType: string;
}
